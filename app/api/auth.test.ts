/**
 * Tests for director/admin auth routes and tournament ownership.
 *
 * Covers:
 *  - POST /api/directors (invite-only creation)
 *  - POST /api/auth/login (admin secret + director credentials)
 *  - POST/GET /api/admin/tournaments ownership stamping + scoped listing
 *  - Ownership gating on a per-tournament management route (close)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectorRecord, TournamentRecord } from '@/lib/db/queries';
import type { GlobalSessionPayload } from '@/lib/auth/session';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/queries', () => {
  // Defined inside the factory because vi.mock is hoisted above module scope.
  class DuplicateEmailError extends Error {
    readonly code = 'DUPLICATE_EMAIL' as const;
    constructor() {
      super('A director with that email already exists.');
      this.name = 'DuplicateEmailError';
    }
  }
  return {
    DuplicateEmailError,
    putDirector: vi.fn(),
    getDirectorByEmail: vi.fn(),
    getDirectorById: vi.fn(),
    listDirectors: vi.fn(),
    setDirectorDisabled: vi.fn(),
    putTournament: vi.fn(),
    listTournaments: vi.fn(),
    listTournamentsByOwner: vi.fn(),
    getTournamentMeta: vi.fn(),
    closeTournament: vi.fn(),
    deleteGlobalSession: vi.fn(),
    assignTournamentOwner: vi.fn(),
    clearTournamentData: vi.fn(),
    deleteTeam: vi.fn(),
    deleteReferee: vi.fn(),
    createPlaceholderTeam: vi.fn(),
    createPlaceholderReferee: vi.fn(),
    queryAllTournamentItems: vi.fn(),
  };
});

vi.mock('@/lib/calls/manager', () => ({
  createCall: vi.fn(),
  acknowledgeCall: vi.fn(),
  completeCallAsAdmin: vi.fn(),
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: vi.fn(async (p: string) => `scrypt:mock:${p}`),
  verifyPassword: vi.fn(async () => true),
  getDummyPasswordHash: vi.fn(async () => 'scrypt:mock:dummy'),
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
}));

vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    generateToken: vi.fn(() => 'mock-uuid'),
    verifyToken: vi.fn(() => false),
  };
});

// Mock session module: control getGlobalSession + issueGlobalSession, keep the rest.
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getGlobalSession: vi.fn(async () => null),
    issueGlobalSession: vi.fn(async () => ({
      sessionId: 'gsess-1',
      cookieHeader: 'gsession=gsess-1; HttpOnly; SameSite=Lax; Path=/',
    })),
    clearGlobalSessionCookie: vi.fn(() => 'gsession=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'),
    revokeGlobalSession: vi.fn(async () => {}),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  putDirector,
  getDirectorByEmail,
  getDirectorById,
  listDirectors,
  setDirectorDisabled,
  putTournament,
  listTournaments,
  listTournamentsByOwner,
  getTournamentMeta,
  closeTournament,
  assignTournamentOwner,
  clearTournamentData,
  deleteTeam,
  deleteReferee,
  createPlaceholderTeam,
  createPlaceholderReferee,
  queryAllTournamentItems,
  DuplicateEmailError,
} from '@/lib/db/queries';
import { createCall, acknowledgeCall, completeCallAsAdmin } from '@/lib/calls/manager';
import { verifyPassword } from '@/lib/auth/password';
import { verifyToken } from '@/lib/auth/tokens';
import { getGlobalSession, issueGlobalSession, revokeGlobalSession } from '@/lib/auth/session';

import { POST as directorsPost, GET as directorsGet } from '@/app/api/directors/route';
import { PATCH as directorPatch } from '@/app/api/directors/[id]/route';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as logoutPost } from '@/app/api/auth/logout/route';
import { POST as createTournamentPost, GET as listTournamentsGet } from '@/app/api/admin/tournaments/route';
import { POST as closePost } from '@/app/api/tournaments/[id]/close/route';
import { PATCH as ownerPatch } from '@/app/api/tournaments/[id]/owner/route';
import { DELETE as participantsDelete } from '@/app/api/tournaments/[id]/participants/route';
import { DELETE as teamDelete } from '@/app/api/tournaments/[id]/teams/[teamId]/route';
import { DELETE as refereeDelete } from '@/app/api/tournaments/[id]/referees/[refId]/route';
import { POST as adminPlacePost } from '@/app/api/tournaments/[id]/admin/calls/route';
import { POST as adminAckPost } from '@/app/api/tournaments/[id]/admin/calls/[callId]/acknowledge/route';
import { POST as adminCompletePost } from '@/app/api/tournaments/[id]/admin/calls/[callId]/complete/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_SECRET = 'test-admin-secret';

function req(method: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = { method, headers: new Headers(headers) };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Headers).set('content-type', 'application/json');
  }
  return new Request('http://localhost:3000/test', init);
}

function makeDirector(overrides?: Partial<DirectorRecord>): DirectorRecord {
  return {
    directorId: 'd_1',
    email: 'dana@example.com',
    name: 'Dana Director',
    passwordHash: 'scrypt:mock:pw',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTournament(overrides?: Partial<TournamentRecord>): TournamentRecord {
  return {
    tournamentId: 't_1',
    name: 'Test',
    status: 'active',
    tableNumbers: [1, 2, 3],
    adminTokenHash: 'sha256:admin',
    refereeTokenHash: 'sha256:ref',
    playerTokenHash: 'sha256:player',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function adminGSession(): GlobalSessionPayload {
  return {
    sessionId: 'g1',
    role: 'admin',
    entityId: 'admin',
    displayName: 'Admin',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

function directorGSession(directorId = 'd_1'): GlobalSessionPayload {
  return {
    sessionId: 'g2',
    role: 'director',
    entityId: directorId,
    displayName: 'Dana',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

// ===========================================================================
// POST /api/directors
// ===========================================================================

describe('POST /api/directors', () => {
  it('returns 401 without admin auth', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    const res = await directorsPost(
      req('POST', { name: 'X', email: 'x@y.com', password: 'password123' }),
    );
    expect(res.status).toBe(401);
  });

  it('creates a director when authorized via ADMIN_SECRET bearer', async () => {
    vi.mocked(getDirectorByEmail).mockResolvedValue(null);
    vi.mocked(putDirector).mockResolvedValue(undefined);

    const res = await directorsPost(
      req('POST', { name: 'Dana', email: 'Dana@Example.com', password: 'password123' }, {
        authorization: `Bearer ${ADMIN_SECRET}`,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.email).toBe('dana@example.com'); // lowercased
    expect(body.directorId).toBeDefined();
    // Never leak the password hash
    expect(JSON.stringify(body)).not.toContain('scrypt:');
    expect(putDirector).toHaveBeenCalled();
  });

  it('rejects a weak password', async () => {
    const res = await directorsPost(
      req('POST', { name: 'Dana', email: 'dana@example.com', password: 'short' }, {
        authorization: `Bearer ${ADMIN_SECRET}`,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email with 409', async () => {
    vi.mocked(getDirectorByEmail).mockResolvedValue(makeDirector());
    const res = await directorsPost(
      req('POST', { name: 'Dana', email: 'dana@example.com', password: 'password123' }, {
        authorization: `Bearer ${ADMIN_SECRET}`,
      }),
    );
    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// POST /api/auth/login
// ===========================================================================

describe('POST /api/auth/login', () => {
  it('logs in the admin with the correct secret', async () => {
    const res = await loginPost(req('POST', { adminSecret: ADMIN_SECRET }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('gsession');
    const body = await res.json();
    expect(body.role).toBe('admin');
    expect(issueGlobalSession).toHaveBeenCalled();
  });

  it('rejects a wrong admin secret', async () => {
    const res = await loginPost(req('POST', { adminSecret: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('logs in a director with valid credentials', async () => {
    vi.mocked(getDirectorByEmail).mockResolvedValue(makeDirector());
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const res = await loginPost(req('POST', { email: 'dana@example.com', password: 'password123' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('gsession');
    const body = await res.json();
    expect(body.role).toBe('director');
    expect(body.directorId).toBe('d_1');
  });

  it('rejects invalid director credentials', async () => {
    vi.mocked(getDirectorByEmail).mockResolvedValue(makeDirector());
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const res = await loginPost(req('POST', { email: 'dana@example.com', password: 'bad' }));
    expect(res.status).toBe(401);
  });

  it('rejects a login for an unknown email without leaking existence', async () => {
    vi.mocked(getDirectorByEmail).mockResolvedValue(null);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const res = await loginPost(req('POST', { email: 'ghost@example.com', password: 'whatever1' }));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// POST/GET /api/admin/tournaments — ownership
// ===========================================================================

describe('tournament ownership on create/list', () => {
  it('stamps ownerId when a director creates a tournament', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_1'));
    vi.mocked(putTournament).mockResolvedValue(undefined);

    const res = await createTournamentPost(
      req('POST', { name: 'Dana Cup', tableRange: '1-4' }),
    );
    expect(res.status).toBe(201);
    const arg = vi.mocked(putTournament).mock.calls[0][0];
    expect(arg.ownerId).toBe('d_1');
  });

  it('does not stamp ownerId for the legacy ADMIN_SECRET create path', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    vi.mocked(putTournament).mockResolvedValue(undefined);

    const res = await createTournamentPost(
      req('POST', { name: 'Admin Cup', tableRange: '1-4' }, {
        authorization: `Bearer ${ADMIN_SECRET}`,
      }),
    );
    expect(res.status).toBe(201);
    const arg = vi.mocked(putTournament).mock.calls[0][0];
    expect(arg.ownerId).toBeUndefined();
  });

  it('rejects unauthenticated create', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    const res = await createTournamentPost(req('POST', { name: 'X', tableRange: '1-4' }));
    expect(res.status).toBe(401);
  });

  it('lists only the director\'s own tournaments', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_1'));
    vi.mocked(listTournamentsByOwner).mockResolvedValue([makeTournament({ ownerId: 'd_1' })]);

    const res = await listTournamentsGet(req('GET'));
    expect(res.status).toBe(200);
    expect(listTournamentsByOwner).toHaveBeenCalledWith('d_1');
    expect(listTournaments).not.toHaveBeenCalled();
  });

  it('lists all tournaments for the admin', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(listTournaments).mockResolvedValue([makeTournament()]);

    const res = await listTournamentsGet(req('GET'));
    expect(res.status).toBe(200);
    expect(listTournaments).toHaveBeenCalled();
    expect(listTournamentsByOwner).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Ownership gating on per-tournament management (close)
// ===========================================================================

describe('close route ownership gating', () => {
  it('allows the owning director to close their tournament', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_1'));
    vi.mocked(closeTournament).mockResolvedValue(undefined);

    const res = await closePost(req('POST'), { params: Promise.resolve({ id: 't_1' }) });
    expect(res.status).toBe(200);
    expect(closeTournament).toHaveBeenCalledWith('t_1');
  });

  it('forbids a non-owning director', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_OTHER'));
    vi.mocked(verifyToken).mockReturnValue(false);

    const res = await closePost(req('POST'), { params: Promise.resolve({ id: 't_1' }) });
    expect(res.status).toBe(401);
    expect(closeTournament).not.toHaveBeenCalled();
  });

  it('allows the admin to close any tournament (including ownerless)', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: undefined }));
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(closeTournament).mockResolvedValue(undefined);

    const res = await closePost(req('POST'), { params: Promise.resolve({ id: 't_1' }) });
    expect(res.status).toBe(200);
  });

  it('forbids a director on an ownerless tournament', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: undefined }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_1'));
    vi.mocked(verifyToken).mockReturnValue(false);

    const res = await closePost(req('POST'), { params: Promise.resolve({ id: 't_1' }) });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// Review-fix coverage: uniqueness race, disabled accounts, logout revocation,
// director list/disable
// ===========================================================================

describe('director creation email-uniqueness race', () => {
  it('returns 409 when the transactional write reports a duplicate', async () => {
    // Pre-check passes (no existing), but the atomic write loses the race.
    vi.mocked(getDirectorByEmail).mockResolvedValue(null);
    vi.mocked(putDirector).mockRejectedValue(new DuplicateEmailError());

    const res = await directorsPost(
      req('POST', { name: 'Dana', email: 'dana@example.com', password: 'password123' }, {
        authorization: `Bearer ${ADMIN_SECRET}`,
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe('login rejects disabled accounts', () => {
  it('returns 403 for a disabled director with valid credentials', async () => {
    vi.mocked(getDirectorByEmail).mockResolvedValue(makeDirector({ disabled: true }));
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const res = await loginPost(req('POST', { email: 'dana@example.com', password: 'password123' }));
    expect(res.status).toBe(403);
    expect(issueGlobalSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session server-side and clears the cookie', async () => {
    const res = await logoutPost(req('POST', undefined, { cookie: 'gsession=abc' }));
    expect(res.status).toBe(200);
    expect(revokeGlobalSession).toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toContain('gsession=;');
  });
});

describe('GET /api/directors (list)', () => {
  it('returns 401 without admin auth', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    const res = await directorsGet(req('GET'));
    expect(res.status).toBe(401);
  });

  it('returns director summaries without password hashes for the admin', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(listDirectors).mockResolvedValue([
      makeDirector({ directorId: 'd_1', email: 'a@x.com', name: 'A' }),
      makeDirector({ directorId: 'd_2', email: 'b@x.com', name: 'B', disabled: true }),
    ]);

    const res = await directorsGet(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('scrypt:');
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });
});

describe('PATCH /api/directors/[id] (enable/disable)', () => {
  const routeParams = { params: Promise.resolve({ id: 'd_1' }) };

  it('returns 401 without admin auth', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    const res = await directorPatch(req('PATCH', { disabled: true }), routeParams);
    expect(res.status).toBe(401);
  });

  it('returns 400 when disabled is not a boolean', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    const res = await directorPatch(req('PATCH', { disabled: 'yes' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the director does not exist', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getDirectorById).mockResolvedValue(null);
    const res = await directorPatch(req('PATCH', { disabled: true }), routeParams);
    expect(res.status).toBe(404);
  });

  it('disables an existing director for the admin', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getDirectorById).mockResolvedValue(makeDirector({ directorId: 'd_1' }));
    vi.mocked(setDirectorDisabled).mockResolvedValue(undefined);

    const res = await directorPatch(req('PATCH', { disabled: true }), routeParams);
    expect(res.status).toBe(200);
    expect(setDirectorDisabled).toHaveBeenCalledWith('d_1', true);
  });
});

// ===========================================================================
// PATCH /api/tournaments/[id]/owner — admin assigns/un-assigns a director
// ===========================================================================

describe('PATCH /api/tournaments/[id]/owner', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1' }) };

  it('returns 401 without admin auth', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    const res = await ownerPatch(req('PATCH', { directorId: 'd_1' }), routeParams);
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid directorId value', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    const res = await ownerPatch(req('PATCH', { directorId: '' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the tournament does not exist', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(null);
    const res = await ownerPatch(req('PATCH', { directorId: 'd_1' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 404 when assigning to a non-existent director', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(getDirectorById).mockResolvedValue(null);
    const res = await ownerPatch(req('PATCH', { directorId: 'd_missing' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('assigns an ownerless tournament to a director', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: undefined }));
    vi.mocked(getDirectorById).mockResolvedValue(makeDirector({ directorId: 'd_1' }));
    vi.mocked(assignTournamentOwner).mockResolvedValue(undefined);

    const res = await ownerPatch(req('PATCH', { directorId: 'd_1' }), routeParams);
    expect(res.status).toBe(200);
    expect(assignTournamentOwner).toHaveBeenCalledWith('t_1', 'd_1');
    const body = await res.json();
    expect(body.ownerId).toBe('d_1');
  });

  it('un-assigns a tournament when directorId is null', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(assignTournamentOwner).mockResolvedValue(undefined);

    const res = await ownerPatch(req('PATCH', { directorId: null }), routeParams);
    expect(res.status).toBe(200);
    expect(assignTournamentOwner).toHaveBeenCalledWith('t_1', null);
    // getDirectorById should not be consulted when un-assigning.
    expect(getDirectorById).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// DELETE /api/tournaments/[id]/participants — clear participants & history
// ===========================================================================

describe('DELETE /api/tournaments/[id]/participants', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1' }) };

  it('returns 404 when the tournament does not exist', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(null);

    const res = await participantsDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(404);
    expect(clearTournamentData).not.toHaveBeenCalled();
  });

  it('forbids a non-owning director', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_OTHER'));
    vi.mocked(verifyToken).mockReturnValue(false);

    const res = await participantsDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(401);
    expect(clearTournamentData).not.toHaveBeenCalled();
  });

  it('clears data for the owning director and returns counts', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_1'));
    vi.mocked(clearTournamentData).mockResolvedValue({
      referees: 2,
      teams: 3,
      calls: 5,
      sessions: 4,
      pushSubscriptions: 1,
    });

    const res = await participantsDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(200);
    expect(clearTournamentData).toHaveBeenCalledWith('t_1');
    const body = await res.json();
    expect(body.cleared.teams).toBe(3);
    expect(body.cleared.calls).toBe(5);
  });

  it('allows the admin to clear any tournament', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: undefined }));
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(clearTournamentData).mockResolvedValue({
      referees: 0, teams: 0, calls: 0, sessions: 0, pushSubscriptions: 0,
    });

    const res = await participantsDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(200);
    expect(clearTournamentData).toHaveBeenCalledWith('t_1');
  });
});

// ===========================================================================
// DELETE /api/tournaments/[id]/teams/[teamId]
// ===========================================================================

describe('DELETE /api/tournaments/[id]/teams/[teamId]', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1', teamId: 'team-9' }) };

  it('returns 404 when the tournament does not exist', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(null);
    const res = await teamDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(404);
    expect(deleteTeam).not.toHaveBeenCalled();
  });

  it('forbids a non-owning director', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_OTHER'));
    vi.mocked(verifyToken).mockReturnValue(false);
    const res = await teamDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(401);
    expect(deleteTeam).not.toHaveBeenCalled();
  });

  it('deletes the team for the owning director and returns counts', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_1'));
    vi.mocked(deleteTeam).mockResolvedValue({ calls: 3, sessions: 1 });

    const res = await teamDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(200);
    expect(deleteTeam).toHaveBeenCalledWith('t_1', 'team-9');
    const body = await res.json();
    expect(body.deleted.calls).toBe(3);
  });
});

// ===========================================================================
// DELETE /api/tournaments/[id]/referees/[refId]
// ===========================================================================

describe('DELETE /api/tournaments/[id]/referees/[refId]', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1', refId: 'ref-9' }) };

  it('forbids a non-owning director', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    vi.mocked(getGlobalSession).mockResolvedValue(directorGSession('d_OTHER'));
    vi.mocked(verifyToken).mockReturnValue(false);
    const res = await refereeDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(401);
    expect(deleteReferee).not.toHaveBeenCalled();
  });

  it('deletes the referee and returns reopened/deleted counts (admin)', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: undefined }));
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(deleteReferee).mockResolvedValue({
      reopenedCalls: 2,
      deletedCompletedCalls: 1,
      sessions: 1,
      pushSubscriptions: 1,
    });

    const res = await refereeDelete(req('DELETE'), routeParams);
    expect(res.status).toBe(200);
    expect(deleteReferee).toHaveBeenCalledWith('t_1', 'ref-9');
    const body = await res.json();
    expect(body.deleted.reopenedCalls).toBe(2);
    expect(body.deleted.deletedCompletedCalls).toBe(1);
  });
});

// ===========================================================================
// Admin on-behalf-of: place / acknowledge / complete
// ===========================================================================

function makeCallRecord(overrides?: Record<string, unknown>) {
  return {
    callId: 'call-1',
    tournamentId: 't_1',
    teamId: 'team-1',
    teamName: 'Team One',
    tableNumber: 3,
    status: 'unanswered',
    refereeId: null,
    refereeName: null,
    createdAt: '2025-01-01T10:00:00.000Z',
    acknowledgedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe('POST /api/tournaments/[id]/admin/calls (place on behalf)', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1' }) };

  it('returns 401 without admin/owner auth', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    const res = await adminPlacePost(req('POST', { tableNumber: 3, teamId: 'team-1' }), routeParams);
    expect(res.status).toBe(401);
  });

  it('returns 400 when neither teamId nor newTeamName is provided', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    const res = await adminPlacePost(req('POST', { tableNumber: 3 }), routeParams);
    expect(res.status).toBe(400);
  });

  it('places a call for a new placeholder team', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(createPlaceholderTeam).mockResolvedValue({ teamId: 'team-new', name: 'Walk-ins' });
    vi.mocked(createCall).mockResolvedValue(
      makeCallRecord({ teamId: 'team-new', teamName: 'Walk-ins' }) as never,
    );

    const res = await adminPlacePost(
      req('POST', { tableNumber: 3, newTeamName: 'Walk-ins' }),
      routeParams,
    );
    expect(res.status).toBe(201);
    expect(createPlaceholderTeam).toHaveBeenCalledWith('t_1', 'Walk-ins');
    expect(createCall).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-new', teamName: 'Walk-ins', tableNumber: 3 }),
    );
  });

  it('places a call for an existing team', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(queryAllTournamentItems).mockResolvedValue({
      tournament: makeTournament(),
      calls: [],
      referees: [],
      teams: [{ teamId: 'team-1', tournamentId: 't_1', name: 'Team One', joinedAt: 'x' }],
      sessions: [],
    });
    vi.mocked(createCall).mockResolvedValue(makeCallRecord() as never);

    const res = await adminPlacePost(req('POST', { tableNumber: 3, teamId: 'team-1' }), routeParams);
    expect(res.status).toBe(201);
    expect(createCall).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-1', teamName: 'Team One' }),
    );
  });
});

describe('POST /api/tournaments/[id]/admin/calls/[callId]/acknowledge (on behalf)', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1', callId: 'call-1' }) };

  it('acknowledges as a new placeholder referee', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(createPlaceholderReferee).mockResolvedValue({ refereeId: 'ref-new', name: 'Sam' });
    vi.mocked(acknowledgeCall).mockResolvedValue(
      makeCallRecord({ status: 'acknowledged', refereeId: 'ref-new', refereeName: 'Sam', acknowledgedAt: 'x' }) as never,
    );

    const res = await adminAckPost(req('POST', { newRefereeName: 'Sam' }), routeParams);
    expect(res.status).toBe(200);
    expect(createPlaceholderReferee).toHaveBeenCalledWith('t_1', 'Sam');
    expect(acknowledgeCall).toHaveBeenCalledWith('call-1', 'ref-new', 'Sam', 't_1');
  });
});

describe('POST /api/tournaments/[id]/admin/calls/[callId]/complete (on behalf)', () => {
  const routeParams = { params: Promise.resolve({ id: 't_1', callId: 'call-1' }) };

  it('completes an acknowledged call on behalf of the referee', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(adminGSession());
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(completeCallAsAdmin).mockResolvedValue(
      makeCallRecord({ status: 'completed', completedAt: 'x' }) as never,
    );

    const res = await adminCompletePost(req('POST', {}), routeParams);
    expect(res.status).toBe(200);
    expect(completeCallAsAdmin).toHaveBeenCalledWith('call-1', 't_1');
  });

  it('returns 401 without admin/owner auth', async () => {
    vi.mocked(getGlobalSession).mockResolvedValue(null);
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ ownerId: 'd_1' }));
    const res = await adminCompletePost(req('POST', {}), routeParams);
    expect(res.status).toBe(401);
  });
});
