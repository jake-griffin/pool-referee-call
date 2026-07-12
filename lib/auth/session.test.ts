/**
 * Unit tests for lib/auth/session.ts (Session_Manager)
 *
 * Tests cover:
 *  - issueSession returns a cookie header with HttpOnly and SameSite=Lax flags
 *  - getSession returns null when expiresAt is in the past
 *  - requireSession throws AuthError for wrong role and wrong tournament
 *
 * Requirements: 15.1, 15.2, 15.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DynamoDB queries module
vi.mock('@/lib/db/queries', () => ({
  putSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
}));

// Mock the tokens module
vi.mock('@/lib/auth/tokens', () => ({
  generateToken: vi.fn().mockReturnValue('mock-session-uuid-1234'),
}));

import {
  issueSession,
  getSession,
  requireSession,
  AuthError,
} from '@/lib/auth/session';
import { putSession, getSession as dbGetSession } from '@/lib/db/queries';
import { generateToken } from '@/lib/auth/tokens';

// ---------------------------------------------------------------------------
// issueSession
// ---------------------------------------------------------------------------

describe('issueSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a cookie header containing HttpOnly flag', async () => {
    const result = await issueSession({
      tournamentId: 't_1',
      role: 'referee',
      entityId: 'ref-1',
      displayName: 'Alice',
    });

    expect(result.cookieHeader).toContain('HttpOnly');
  });

  it('returns a cookie header containing SameSite=Lax flag', async () => {
    const result = await issueSession({
      tournamentId: 't_1',
      role: 'player',
      entityId: 'team-1',
      displayName: 'Team Rocket',
    });

    expect(result.cookieHeader).toContain('SameSite=Lax');
  });

  it('returns a cookie header with the sessionId as the cookie value', async () => {
    const result = await issueSession({
      tournamentId: 't_1',
      role: 'referee',
      entityId: 'ref-1',
      displayName: 'Alice',
    });

    expect(result.sessionId).toBe('mock-session-uuid-1234');
    expect(result.cookieHeader).toContain('sessionId=mock-session-uuid-1234');
  });

  it('returns a cookie header with Path=/', async () => {
    const result = await issueSession({
      tournamentId: 't_1',
      role: 'referee',
      entityId: 'ref-1',
      displayName: 'Alice',
    });

    expect(result.cookieHeader).toContain('Path=/');
  });

  it('returns a cookie header with an Expires value', async () => {
    const result = await issueSession({
      tournamentId: 't_1',
      role: 'player',
      entityId: 'team-1',
      displayName: 'Team Rocket',
    });

    expect(result.cookieHeader).toMatch(/Expires=.+/);
  });

  it('persists the session record to DynamoDB', async () => {
    await issueSession({
      tournamentId: 't_1',
      role: 'referee',
      entityId: 'ref-1',
      displayName: 'Alice',
    });

    expect(putSession).toHaveBeenCalledTimes(1);
    expect(putSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'mock-session-uuid-1234',
        tournamentId: 't_1',
        role: 'referee',
        entityId: 'ref-1',
        displayName: 'Alice',
      }),
    );
  });

  it('sets the expiresAt field on the persisted session record', async () => {
    const before = Date.now();
    await issueSession({
      tournamentId: 't_1',
      role: 'player',
      entityId: 'team-1',
      displayName: 'Team Rocket',
    });
    const after = Date.now();

    const storedRecord = (putSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const expiresAtMs = new Date(storedRecord.expiresAt).getTime();

    // Default TTL is 24 hours
    const expectedMin = before + 24 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAtMs).toBeLessThanOrEqual(expectedMax);
  });

  it('respects custom ttlHours parameter', async () => {
    const before = Date.now();
    await issueSession(
      {
        tournamentId: 't_1',
        role: 'admin',
        entityId: 'admin-1',
        displayName: 'Admin',
      },
      48,
    );
    const after = Date.now();

    const storedRecord = (putSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const expiresAtMs = new Date(storedRecord.expiresAt).getTime();

    const expectedMin = before + 48 * 60 * 60 * 1000;
    const expectedMax = after + 48 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAtMs).toBeLessThanOrEqual(expectedMax);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when expiresAt is in the past', async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

    (dbGetSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: 'sess-expired',
      role: 'referee',
      tournamentId: 't_1',
      entityId: 'ref-1',
      displayName: 'Alice',
      expiresAt: pastDate,
    });

    const request = new Request('http://localhost/api/test', {
      headers: { cookie: 'sessionId=sess-expired' },
    });

    const result = await getSession(request, 't_1');

    expect(result).toBeNull();
  });

  it('returns null when no cookie is present', async () => {
    const request = new Request('http://localhost/api/test');

    const result = await getSession(request, 't_1');

    expect(result).toBeNull();
    expect(dbGetSession).not.toHaveBeenCalled();
  });

  it('returns null when the session record does not exist in DynamoDB', async () => {
    (dbGetSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/test', {
      headers: { cookie: 'sessionId=nonexistent-session' },
    });

    const result = await getSession(request, 't_1');

    expect(result).toBeNull();
  });

  it('returns null when tournamentId is not provided', async () => {
    const request = new Request('http://localhost/api/test', {
      headers: { cookie: 'sessionId=some-session' },
    });

    const result = await getSession(request);

    expect(result).toBeNull();
  });

  it('returns the session payload when the session is valid and not expired', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    (dbGetSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: 'sess-valid',
      role: 'player',
      tournamentId: 't_1',
      entityId: 'team-1',
      displayName: 'Team Rocket',
      expiresAt: futureDate,
    });

    const request = new Request('http://localhost/api/test', {
      headers: { cookie: 'sessionId=sess-valid' },
    });

    const result = await getSession(request, 't_1');

    expect(result).toEqual({
      sessionId: 'sess-valid',
      role: 'player',
      tournamentId: 't_1',
      entityId: 'team-1',
      displayName: 'Team Rocket',
      expiresAt: futureDate,
    });
  });

  it('returns null when expiresAt is exactly now (boundary case)', async () => {
    // Use a date that is "now" — the implementation checks expiresAt <= new Date()
    const nowDate = new Date().toISOString();

    (dbGetSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: 'sess-boundary',
      role: 'referee',
      tournamentId: 't_1',
      entityId: 'ref-1',
      displayName: 'Alice',
      expiresAt: nowDate,
    });

    const request = new Request('http://localhost/api/test', {
      headers: { cookie: 'sessionId=sess-boundary' },
    });

    const result = await getSession(request, 't_1');

    expect(result).toBeNull();
  });

  it('correctly parses sessionId from a multi-cookie header', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    (dbGetSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: 'sess-multi',
      role: 'admin',
      tournamentId: 't_1',
      entityId: 'admin-1',
      displayName: 'Admin',
      expiresAt: futureDate,
    });

    const request = new Request('http://localhost/api/test', {
      headers: { cookie: 'theme=dark; sessionId=sess-multi; lang=en' },
    });

    const result = await getSession(request, 't_1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-multi');
  });
});

// ---------------------------------------------------------------------------
// requireSession
// ---------------------------------------------------------------------------

describe('requireSession', () => {
  it('throws AuthError with 401 when session is null', () => {
    expect(() => requireSession(null, 't_1', ['referee'])).toThrow(AuthError);

    try {
      requireSession(null, 't_1', ['referee']);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).statusCode).toBe(401);
      expect((err as AuthError).message).toContain('session has expired');
    }
  });

  it('throws AuthError with 403 when session belongs to a different tournament', () => {
    const session = {
      sessionId: 'sess-1',
      tournamentId: 't_other',
      role: 'referee' as const,
      entityId: 'ref-1',
      displayName: 'Alice',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    expect(() => requireSession(session, 't_1', ['referee'])).toThrow(AuthError);

    try {
      requireSession(session, 't_1', ['referee']);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).statusCode).toBe(403);
      expect((err as AuthError).message).toContain('does not belong to this tournament');
    }
  });

  it('throws AuthError with 403 when session role is not in allowedRoles', () => {
    const session = {
      sessionId: 'sess-1',
      tournamentId: 't_1',
      role: 'player' as const,
      entityId: 'team-1',
      displayName: 'Team Rocket',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    expect(() => requireSession(session, 't_1', ['referee'])).toThrow(AuthError);

    try {
      requireSession(session, 't_1', ['referee']);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).statusCode).toBe(403);
      expect((err as AuthError).message).toContain('Insufficient permissions');
    }
  });

  it('does not throw when session matches tournament and role', () => {
    const session = {
      sessionId: 'sess-1',
      tournamentId: 't_1',
      role: 'referee' as const,
      entityId: 'ref-1',
      displayName: 'Alice',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    expect(() => requireSession(session, 't_1', ['referee'])).not.toThrow();
  });

  it('does not throw when role is one of multiple allowed roles', () => {
    const session = {
      sessionId: 'sess-1',
      tournamentId: 't_1',
      role: 'admin' as const,
      entityId: 'admin-1',
      displayName: 'Admin',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    expect(() =>
      requireSession(session, 't_1', ['referee', 'admin']),
    ).not.toThrow();
  });

  it('throws AuthError with 403 when role is not in a multi-role allowedRoles list', () => {
    const session = {
      sessionId: 'sess-1',
      tournamentId: 't_1',
      role: 'player' as const,
      entityId: 'team-1',
      displayName: 'Team Rocket',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    try {
      requireSession(session, 't_1', ['referee', 'admin']);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).statusCode).toBe(403);
    }
  });
});
