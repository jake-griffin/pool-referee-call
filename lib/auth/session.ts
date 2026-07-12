/**
 * lib/auth/session.ts
 *
 * Session_Manager — issues, reads, and validates HTTP-only session cookies.
 *
 * Session lifecycle:
 *  1. On join: issueSession() creates a SESSION#{sessionId} record in DynamoDB
 *     and returns a Set-Cookie header string (HTTP-only, Secure, SameSite=Lax).
 *  2. On every authenticated request: getSession() reads the sessionId from
 *     the Cookie header, fetches the DynamoDB record, checks expiry.
 *  3. Route handlers call requireSession() to assert role + tournament match,
 *     throwing a typed AuthError that maps to 401 or 403.
 *
 * Requirements: 4.4, 5.4, 15.1, 15.2, 15.3, 15.4
 */

import { generateToken } from '@/lib/auth/tokens';
import { putSession, getSession as dbGetSession } from '@/lib/db/queries';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface SessionPayload {
  sessionId:    string;
  tournamentId: string;
  role:         'referee' | 'player' | 'admin';
  entityId:     string;   // refereeId or teamId
  displayName:  string;
  expiresAt:    string;   // ISO 8601
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// issueSession
// ---------------------------------------------------------------------------

const DEFAULT_TTL_HOURS = 24;
const COOKIE_NAME = 'sessionId';

/**
 * Creates a new session record in DynamoDB and returns a Set-Cookie header.
 *
 * The cookie value is the raw sessionId (a UUID). All payload lives in DynamoDB —
 * the cookie itself is opaque.
 *
 * Cookie flags:
 *   HttpOnly  — not accessible to client-side JS (Requirement 15.1)
 *   Secure    — HTTPS only in production
 *   SameSite=Lax — balanced CSRF protection
 *   Path=/    — available on all routes
 *
 * Requirements: 15.1, 15.2, 15.4
 */
export async function issueSession(
  payload: Omit<SessionPayload, 'sessionId' | 'expiresAt'>,
  ttlHours: number = DEFAULT_TTL_HOURS,
): Promise<{ sessionId: string; cookieHeader: string }> {
  const sessionId = generateToken();
  const expiresAt = new Date(
    Date.now() + ttlHours * 60 * 60 * 1000,
  ).toISOString();

  const record: SessionPayload = {
    ...payload,
    sessionId,
    expiresAt,
  };

  // Persist session to DynamoDB (Requirement 15.2)
  await putSession({
    sessionId: record.sessionId,
    role: record.role,
    tournamentId: record.tournamentId,
    entityId: record.entityId,
    displayName: record.displayName,
    expiresAt: record.expiresAt,
  });

  // Build the Set-Cookie header value
  const expires = new Date(expiresAt).toUTCString();
  const isProduction = process.env.NODE_ENV === 'production';
  const securePart = isProduction ? '; Secure' : '';
  const cookieHeader = [
    `${COOKIE_NAME}=${sessionId}`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Path=/`,
    `Expires=${expires}`,
    securePart,
  ]
    .filter(Boolean)
    .join('; ');

  return { sessionId, cookieHeader };
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

/**
 * Reads and validates the session cookie from an incoming Request.
 *
 * Steps:
 *  1. Parse the Cookie header to extract sessionId.
 *  2. GetItem SESSION#{sessionId} from DynamoDB (keyed by tournamentId from
 *     the request path — caller extracts tournamentId and passes it).
 *  3. If the record is missing → return null.
 *  4. If expiresAt is in the past → return null (expired).
 *  5. Return the SessionPayload.
 *
 * NOTE: This overload accepts a Request + tournamentId so the DynamoDB lookup
 * can use the correct partition key. The route handlers always know their
 * tournamentId from the URL path.
 *
 * Requirements: 15.1, 15.3
 */
export async function getSession(
  request: Request,
  tournamentId: string,
): Promise<SessionPayload | null>;

/**
 * Overload that parses tournamentId from a cookie claim.
 * Used when tournamentId is stored in the session itself (admin routes).
 */
export async function getSession(request: Request): Promise<SessionPayload | null>;

export async function getSession(
  request: Request,
  tournamentId?: string,
): Promise<SessionPayload | null> {
  const sessionId = extractSessionIdFromCookie(request);
  if (!sessionId) return null;

  // If tournamentId is not provided, we cannot look up the session efficiently
  // without a scan. Callers on tournament-scoped routes always supply it.
  // For cases without a known tournamentId we return null (not authorised).
  if (!tournamentId) return null;

  const record = await dbGetSession(tournamentId, sessionId);
  if (!record) return null;

  // Check expiry (Requirement 15.3)
  if (new Date(record.expiresAt) <= new Date()) return null;

  return {
    sessionId: record.sessionId,
    tournamentId: record.tournamentId,
    role: record.role,
    entityId: record.entityId,
    displayName: record.displayName,
    expiresAt: record.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// requireSession
// ---------------------------------------------------------------------------

/**
 * Asserts the session is present, belongs to the expected tournament, and
 * holds one of the allowed roles.
 *
 * Throws AuthError (mapped to 401/403 at the route handler level) on failure.
 *
 * Requirements: 15.1, 15.2, 15.3
 */
export function requireSession(
  session: SessionPayload | null,
  tournamentId: string,
  allowedRoles: SessionPayload['role'][],
): asserts session is SessionPayload {
  if (!session) {
    throw new AuthError(
      'Your session has expired — please rejoin using your link.',
      401,
    );
  }
  if (session.tournamentId !== tournamentId) {
    throw new AuthError('Session does not belong to this tournament.', 403);
  }
  if (!allowedRoles.includes(session.role)) {
    throw new AuthError('Insufficient permissions for this action.', 403);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Parses the Cookie request header and returns the value of the sessionId
 * cookie, or null if not present.
 */
function extractSessionIdFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim();
    if (key === COOKIE_NAME) {
      return rest.join('=').trim() || null;
    }
  }
  return null;
}
