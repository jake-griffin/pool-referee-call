/**
 * lib/auth/tournament-access.ts
 *
 * Authorization helpers for deciding who may manage a given tournament.
 *
 * Access rules:
 *   - The global admin (ADMIN_SECRET holder, via a global admin session) may
 *     manage ANY tournament.
 *   - A Tournament Director may manage ONLY tournaments they own
 *     (tournament.ownerId === director.entityId).
 *   - Tournaments with no ownerId (created before director accounts existed)
 *     are manageable by the admin only.
 *   - The legacy per-tournament adminToken continues to work as a fallback and
 *     is checked separately by callers that support it.
 */

import { getGlobalSession, type GlobalSessionPayload } from '@/lib/auth/session';
import { verifyToken } from '@/lib/auth/tokens';
import type { TournamentRecord } from '@/lib/db/queries';

/**
 * Returns true if the given global session is allowed to manage the tournament.
 * Admin: always. Director: only if they own it.
 */
export function canManageTournament(
  session: GlobalSessionPayload | null,
  tournament: Pick<TournamentRecord, 'ownerId'>,
): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'director') {
    return !!tournament.ownerId && tournament.ownerId === session.entityId;
  }
  return false;
}

/**
 * Central authorization for per-tournament management actions (close, manage
 * tables, view join links, etc.). Grants access when either:
 *   - the caller has a global session (admin, or the owning director), or
 *   - a valid legacy per-tournament admin token is supplied.
 *
 * `adminToken` is the plaintext token from the request (Bearer header or body),
 * checked against the tournament's stored adminTokenHash. Pass null/undefined
 * when the caller doesn't support the legacy token path.
 */
export async function authorizeTournamentManagement(
  request: Request,
  tournament: Pick<TournamentRecord, 'ownerId' | 'adminTokenHash'>,
  adminToken?: string | null,
): Promise<boolean> {
  // 1. Global session (director-owner or admin)
  const session = await getGlobalSession(request);
  if (canManageTournament(session, tournament)) return true;

  // 2. Legacy per-tournament admin token
  if (adminToken && verifyToken(adminToken, tournament.adminTokenHash)) {
    return true;
  }

  return false;
}
