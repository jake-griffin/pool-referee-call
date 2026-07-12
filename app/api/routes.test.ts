/**
 * Unit tests for API route handlers
 *
 * Tests cover all route handlers' happy paths and error branches.
 * Verifies raw DynamoDB errors and stack traces are never in response bodies.
 *
 * Requirements: 1.2, 6.6, 7.5, 8.3, 8.4, 13.5, 14.5, 20.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TournamentRecord, CallRecord, TournamentStateResponse } from '@/lib/db/queries';
import type { SessionPayload } from '@/lib/auth/session';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/queries', () => ({
  getTournamentMeta: vi.fn(),
  putTournament: vi.fn(),
  listTournaments: vi.fn(),
  putReferee: vi.fn(),
  putTeam: vi.fn(),
  getTournamentState: vi.fn(),
  closeTournament: vi.fn(),
  queryAllTournamentItems: vi.fn(),
}));

vi.mock('@/lib/auth/tokens', () => ({
  generateToken: vi.fn(() => 'mock-uuid-token'),
  hashToken: vi.fn((t: string) => `sha256:${t}`),
  verifyToken: vi.fn(() => true),
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getSession: vi.fn(),
    requireSession: vi.fn(),
    issueSession: vi.fn(),
  };
});

vi.mock('@/lib/calls/manager', () => ({
  createCall: vi.fn(),
  acknowledgeCall: vi.fn(),
  completeCall: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  getTournamentMeta,
  putTournament,
  listTournaments,
  putReferee,
  putTeam,
  getTournamentState,
  closeTournament,
  queryAllTournamentItems,
} from '@/lib/db/queries';

import { generateToken, hashToken, verifyToken } from '@/lib/auth/tokens';
import { getSession, requireSession, issueSession, AuthError } from '@/lib/auth/session';
import { createCall, acknowledgeCall, completeCall } from '@/lib/calls/manager';

import {
  TournamentClosedError,
  InvalidTableError,
  MaxCallsError,
  AlreadyClaimedError,
  CallNotFoundError,
  WrongRefereeError,
  WrongStatusError,
} from '@/lib/calls/errors';

import { POST as adminTournamentsPost, GET as adminTournamentsGet } from '@/app/api/admin/tournaments/route';
import { POST as joinRefereePost } from '@/app/api/tournaments/[id]/join/referee/route';
import { POST as joinPlayerPost } from '@/app/api/tournaments/[id]/join/player/route';
import { POST as createCallPost } from '@/app/api/tournaments/[id]/calls/route';
import { POST as acknowledgePost } from '@/app/api/calls/[callId]/acknowledge/route';
import { POST as completePost } from '@/app/api/calls/[callId]/complete/route';
import { GET as stateGet } from '@/app/api/tournaments/[id]/state/route';
import { POST as closePost } from '@/app/api/tournaments/[id]/close/route';
import { GET as archiveGet } from '@/app/api/tournaments/[id]/archive/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(method: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = { method, headers: new Headers(headers) };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Headers).set('content-type', 'application/json');
  }
  return new Request('http://localhost:3000/test', init);
}

function makeTournament(overrides?: Partial<TournamentRecord>): TournamentRecord {
  return {
    tournamentId: 'tournament-1',
    name: 'Test Tournament',
    status: 'active',
    tableNumbers: [1, 2, 3, 4, 5],
    adminTokenHash: 'sha256:admin-token',
    refereeTokenHash: 'sha256:referee-token',
    playerTokenHash: 'sha256:player-token',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SessionPayload>): SessionPayload {
  return {
    sessionId: 'session-1',
    tournamentId: 'tournament-1',
    role: 'referee',
    entityId: 'ref-1',
    displayName: 'Alice',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Asserts that error responses never leak internal details.
 */
function assertNoLeakedDetails(body: Record<string, unknown>) {
  const bodyStr = JSON.stringify(body);
  expect(bodyStr).not.toContain('stack');
  expect(bodyStr).not.toMatch(/at\s+\w/); // stack trace indicator
  expect(bodyStr).not.toContain('DynamoDB');
  expect(bodyStr).not.toContain('aws-sdk');
  expect(typeof body.message).toBe('string');
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ADMIN_SECRET = 'test-admin-secret';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});


// ===========================================================================
// POST /api/admin/tournaments
// ===========================================================================

describe('POST /api/admin/tournaments', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = createRequest('POST', { name: 'Tourney', tableRange: '1-5' });
    const res = await adminTournamentsPost(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 401 when ADMIN_SECRET does not match', async () => {
    const req = createRequest('POST', { name: 'Tourney', tableRange: '1-5' }, {
      authorization: 'Bearer wrong-secret',
    });
    const res = await adminTournamentsPost(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when name is missing or empty', async () => {
    const req = createRequest('POST', { name: '', tableRange: '1-5' }, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    const res = await adminTournamentsPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when tableRange is missing', async () => {
    const req = createRequest('POST', { name: 'Tourney' }, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    const res = await adminTournamentsPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when tableRange is invalid', async () => {
    const req = createRequest('POST', { name: 'Tourney', tableRange: 'abc' }, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    const res = await adminTournamentsPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 201 with tournamentId, tokens, joinLinks on success', async () => {
    vi.mocked(generateToken).mockReturnValue('mock-uuid-token');
    vi.mocked(hashToken).mockReturnValue('sha256:mock-uuid-token');
    vi.mocked(putTournament).mockResolvedValue(undefined);

    const req = createRequest('POST', { name: 'Pool Night', tableRange: '1-5' }, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    const res = await adminTournamentsPost(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.tournamentId).toBeDefined();
    expect(body.adminToken).toBeDefined();
    expect(body.refereeToken).toBeDefined();
    expect(body.playerToken).toBeDefined();
    expect(body.joinLinks).toBeDefined();
    expect(body.joinLinks.referee).toContain('/join/referee/');
    expect(body.joinLinks.player).toContain('/join/player/');
  });

  it('never includes token hashes in response body', async () => {
    vi.mocked(generateToken).mockReturnValue('mock-uuid-token');
    vi.mocked(hashToken).mockReturnValue('sha256:mock-uuid-token');
    vi.mocked(putTournament).mockResolvedValue(undefined);

    const req = createRequest('POST', { name: 'Pool Night', tableRange: '1-5' }, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    const res = await adminTournamentsPost(req);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('TokenHash');
    expect(bodyStr).not.toContain('sha256:');
  });
});

// ===========================================================================
// GET /api/admin/tournaments
// ===========================================================================

describe('GET /api/admin/tournaments', () => {
  it('returns 401 when Authorization is invalid', async () => {
    const req = createRequest('GET', undefined, {
      authorization: 'Bearer wrong-secret',
    });
    const res = await adminTournamentsGet(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with tournament summaries (no token hashes)', async () => {
    vi.mocked(listTournaments).mockResolvedValue([
      makeTournament(),
    ]);

    const req = createRequest('GET', undefined, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    const res = await adminTournamentsGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].tournamentId).toBe('tournament-1');
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('TokenHash');
    expect(bodyStr).not.toContain('sha256:');
  });
});


// ===========================================================================
// POST /api/tournaments/[id]/join/referee
// ===========================================================================

describe('POST /api/tournaments/[id]/join/referee', () => {
  const routeParams = { params: Promise.resolve({ id: 'tournament-1' }) };

  it('returns 401 when token is missing', async () => {
    const req = createRequest('POST', { name: 'Alice' });
    const res = await joinRefereePost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(null);
    const req = createRequest('POST', { token: 'some-token', name: 'Alice' });
    const res = await joinRefereePost(req, routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when tournament is closed', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ status: 'closed' }));
    const req = createRequest('POST', { token: 'some-token', name: 'Alice' });
    const res = await joinRefereePost(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 401 when token is invalid (verifyToken returns false)', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(false);
    const req = createRequest('POST', { token: 'bad-token', name: 'Alice' });
    const res = await joinRefereePost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when name is empty', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(true);
    const req = createRequest('POST', { token: 'valid-token', name: '   ' });
    const res = await joinRefereePost(req, routeParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with refereeId and Set-Cookie header on success', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(true);
    vi.mocked(generateToken).mockReturnValue('mock-ref-id');
    vi.mocked(putReferee).mockResolvedValue(undefined);
    vi.mocked(issueSession).mockResolvedValue({
      sessionId: 'sess-1',
      cookieHeader: 'sessionId=sess-1; HttpOnly; SameSite=Lax; Path=/',
    });

    const req = createRequest('POST', { token: 'valid-token', name: 'Alice' });
    const res = await joinRefereePost(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.refereeId).toBeDefined();
    expect(body.tournamentId).toBe('tournament-1');
    expect(res.headers.get('set-cookie')).toContain('sessionId');
  });
});

// ===========================================================================
// POST /api/tournaments/[id]/join/player
// ===========================================================================

describe('POST /api/tournaments/[id]/join/player', () => {
  const routeParams = { params: Promise.resolve({ id: 'tournament-1' }) };

  it('returns 401 when token is missing', async () => {
    const req = createRequest('POST', { teamName: 'Cool Team' });
    const res = await joinPlayerPost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(null);
    const req = createRequest('POST', { token: 'some-token', teamName: 'Cool Team' });
    const res = await joinPlayerPost(req, routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when tournament is closed', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ status: 'closed' }));
    const req = createRequest('POST', { token: 'some-token', teamName: 'Cool Team' });
    const res = await joinPlayerPost(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 401 when token is invalid', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(false);
    const req = createRequest('POST', { token: 'bad-token', teamName: 'Cool Team' });
    const res = await joinPlayerPost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when teamName is empty', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(true);
    const req = createRequest('POST', { token: 'valid-token', teamName: '' });
    const res = await joinPlayerPost(req, routeParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with teamId and Set-Cookie header on success', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(true);
    vi.mocked(generateToken).mockReturnValue('mock-team-id');
    vi.mocked(putTeam).mockResolvedValue(undefined);
    vi.mocked(issueSession).mockResolvedValue({
      sessionId: 'sess-2',
      cookieHeader: 'sessionId=sess-2; HttpOnly; SameSite=Lax; Path=/',
    });

    const req = createRequest('POST', { token: 'valid-token', teamName: 'Cool Team' });
    const res = await joinPlayerPost(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.teamId).toBeDefined();
    expect(body.tournamentId).toBe('tournament-1');
    expect(res.headers.get('set-cookie')).toContain('sessionId');
  });
});


// ===========================================================================
// POST /api/tournaments/[id]/calls
// ===========================================================================

describe('POST /api/tournaments/[id]/calls', () => {
  const routeParams = { params: Promise.resolve({ id: 'tournament-1' }) };

  it('returns 401 when session is invalid (requireSession throws AuthError)', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(requireSession).mockImplementation(() => {
      throw new AuthError('Your session has expired — please rejoin using your link.', 401);
    });

    const req = createRequest('POST', { tableNumber: 3 });
    const res = await createCallPost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when tournament is closed (createCall throws TournamentClosedError)', async () => {
    const session = makeSession({ role: 'player', entityId: 'team-1' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(createCall).mockRejectedValue(new TournamentClosedError());

    const req = createRequest('POST', { tableNumber: 3 });
    const res = await createCallPost(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when tableNumber is invalid (InvalidTableError)', async () => {
    const session = makeSession({ role: 'player', entityId: 'team-1' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(createCall).mockRejectedValue(new InvalidTableError(99));

    const req = createRequest('POST', { tableNumber: 99 });
    const res = await createCallPost(req, routeParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 429 when at max calls (MaxCallsError)', async () => {
    const session = makeSession({ role: 'player', entityId: 'team-1' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(createCall).mockRejectedValue(new MaxCallsError());

    const req = createRequest('POST', { tableNumber: 3 });
    const res = await createCallPost(req, routeParams);
    expect(res.status).toBe(429);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 400 when tableNumber is not a number', async () => {
    const session = makeSession({ role: 'player', entityId: 'team-1' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});

    const req = createRequest('POST', { tableNumber: 'abc' });
    const res = await createCallPost(req, routeParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 201 with callId on success', async () => {
    const session = makeSession({ role: 'player', entityId: 'team-1', displayName: 'Cool Team' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(createCall).mockResolvedValue({
      callId: 'call-1',
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      teamName: 'Cool Team',
      tableNumber: 3,
      status: 'unanswered',
      refereeId: null,
      refereeName: null,
      createdAt: '2025-01-01T10:00:00.000Z',
      acknowledgedAt: null,
      completedAt: null,
    });

    const req = createRequest('POST', { tableNumber: 3 });
    const res = await createCallPost(req, routeParams);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.callId).toBe('call-1');
    expect(body.status).toBe('unanswered');
    expect(body.createdAt).toBeDefined();
  });
});

// ===========================================================================
// POST /api/calls/[callId]/acknowledge
// ===========================================================================

describe('POST /api/calls/[callId]/acknowledge', () => {
  const routeParams = { params: Promise.resolve({ callId: 'call-1' }) };

  it('returns 401 when session is invalid', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(requireSession).mockImplementation(() => {
      throw new AuthError('Your session has expired — please rejoin using your link.', 401);
    });

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await acknowledgePost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when tournament is closed', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(acknowledgeCall).mockRejectedValue(new TournamentClosedError());

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await acknowledgePost(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 409 when already claimed (AlreadyClaimedError)', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(acknowledgeCall).mockRejectedValue(new AlreadyClaimedError());

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await acknowledgePost(req, routeParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 404 when call not found (CallNotFoundError)', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(acknowledgeCall).mockRejectedValue(new CallNotFoundError('call-1'));

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await acknowledgePost(req, routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with callId, status, acknowledgedAt on success', async () => {
    const session = makeSession({ role: 'referee', entityId: 'ref-1', displayName: 'Alice' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(acknowledgeCall).mockResolvedValue({
      callId: 'call-1',
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      teamName: 'Cool Team',
      tableNumber: 3,
      status: 'acknowledged',
      refereeId: 'ref-1',
      refereeName: 'Alice',
      createdAt: '2025-01-01T10:00:00.000Z',
      acknowledgedAt: '2025-01-01T10:05:00.000Z',
      completedAt: null,
    });

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await acknowledgePost(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.callId).toBe('call-1');
    expect(body.status).toBe('acknowledged');
    expect(body.acknowledgedAt).toBe('2025-01-01T10:05:00.000Z');
  });
});


// ===========================================================================
// POST /api/calls/[callId]/complete
// ===========================================================================

describe('POST /api/calls/[callId]/complete', () => {
  const routeParams = { params: Promise.resolve({ callId: 'call-1' }) };

  it('returns 401 when session is invalid', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(requireSession).mockImplementation(() => {
      throw new AuthError('Your session has expired — please rejoin using your link.', 401);
    });

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await completePost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when tournament is closed', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(completeCall).mockRejectedValue(new TournamentClosedError());

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await completePost(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when wrong referee (WrongRefereeError)', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(completeCall).mockRejectedValue(new WrongRefereeError());

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await completePost(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 409 when wrong status (WrongStatusError)', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(completeCall).mockRejectedValue(new WrongStatusError('acknowledged', 'unanswered'));

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await completePost(req, routeParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 404 when call not found', async () => {
    const session = makeSession({ role: 'referee' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(completeCall).mockRejectedValue(new CallNotFoundError('call-1'));

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await completePost(req, routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with callId, status, completedAt on success', async () => {
    const session = makeSession({ role: 'referee', entityId: 'ref-1' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(completeCall).mockResolvedValue({
      callId: 'call-1',
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      teamName: 'Cool Team',
      tableNumber: 3,
      status: 'completed',
      refereeId: 'ref-1',
      refereeName: 'Alice',
      createdAt: '2025-01-01T10:00:00.000Z',
      acknowledgedAt: '2025-01-01T10:05:00.000Z',
      completedAt: '2025-01-01T10:10:00.000Z',
    });

    const req = createRequest('POST', { tournamentId: 'tournament-1' });
    const res = await completePost(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.callId).toBe('call-1');
    expect(body.status).toBe('completed');
    expect(body.completedAt).toBe('2025-01-01T10:10:00.000Z');
  });
});

// ===========================================================================
// GET /api/tournaments/[id]/state
// ===========================================================================

describe('GET /api/tournaments/[id]/state', () => {
  const routeParams = { params: Promise.resolve({ id: 'tournament-1' }) };

  it('returns 401 when session is invalid', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(requireSession).mockImplementation(() => {
      throw new AuthError('Your session has expired — please rejoin using your link.', 401);
    });

    const req = createRequest('GET');
    const res = await stateGet(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with TournamentStateResponse on success', async () => {
    const session = makeSession({ role: 'player', entityId: 'team-1' });
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(requireSession).mockImplementation(() => {});

    const mockState: TournamentStateResponse = {
      lastUpdatedAt: '2025-01-01T12:00:00.000Z',
      tournament: { name: 'Test Tournament', status: 'active' },
      unansweredQueue: [],
      refereeQueues: {},
      myCalls: [],
    };
    vi.mocked(getTournamentState).mockResolvedValue(mockState);

    const req = createRequest('GET');
    const res = await stateGet(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tournament.name).toBe('Test Tournament');
    expect(body.lastUpdatedAt).toBeDefined();
    expect(body.unansweredQueue).toEqual([]);
    expect(body.refereeQueues).toEqual({});
    expect(body.myCalls).toEqual([]);
  });
});

// ===========================================================================
// POST /api/tournaments/[id]/close
// ===========================================================================

describe('POST /api/tournaments/[id]/close', () => {
  const routeParams = { params: Promise.resolve({ id: 'tournament-1' }) };

  it('returns 401 when adminToken is missing', async () => {
    const req = createRequest('POST');
    const res = await closePost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(null);
    const req = createRequest('POST', undefined, {
      authorization: 'Bearer admin-token',
    });
    const res = await closePost(req, routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 401 when token is invalid', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(false);
    const req = createRequest('POST', undefined, {
      authorization: 'Bearer bad-token',
    });
    const res = await closePost(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with status closed on success', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament());
    vi.mocked(verifyToken).mockReturnValue(true);
    vi.mocked(closeTournament).mockResolvedValue(undefined);

    const req = createRequest('POST', undefined, {
      authorization: 'Bearer admin-token',
    });
    const res = await closePost(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('closed');
    expect(body.tournamentId).toBe('tournament-1');
  });
});

// ===========================================================================
// GET /api/tournaments/[id]/archive
// ===========================================================================

describe('GET /api/tournaments/[id]/archive', () => {
  const routeParams = { params: Promise.resolve({ id: 'tournament-1' }) };

  it('returns 401 when token is missing', async () => {
    const req = createRequest('GET');
    const res = await archiveGet(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(null);
    const req = createRequest('GET', undefined, {
      authorization: 'Bearer admin-token',
    });
    const res = await archiveGet(req, routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 401 when token is invalid', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ status: 'closed' }));
    vi.mocked(verifyToken).mockReturnValue(false);
    const req = createRequest('GET', undefined, {
      authorization: 'Bearer bad-token',
    });
    const res = await archiveGet(req, routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 403 when tournament is still active', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ status: 'active' }));
    vi.mocked(verifyToken).mockReturnValue(true);
    const req = createRequest('GET', undefined, {
      authorization: 'Bearer admin-token',
    });
    const res = await archiveGet(req, routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    assertNoLeakedDetails(body);
  });

  it('returns 200 with archive data on success', async () => {
    vi.mocked(getTournamentMeta).mockResolvedValue(makeTournament({ status: 'closed' }));
    vi.mocked(verifyToken).mockReturnValue(true);
    vi.mocked(queryAllTournamentItems).mockResolvedValue({
      tournament: makeTournament({ status: 'closed' }),
      calls: [],
      referees: [],
      teams: [],
      sessions: [],
    });

    const req = createRequest('GET', undefined, {
      authorization: 'Bearer admin-token',
    });
    const res = await archiveGet(req, routeParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tournament.name).toBe('Test Tournament');
    expect(body.tournament.status).toBe('closed');
    expect(body.calls).toEqual([]);
    expect(body.referees).toEqual([]);
    expect(body.teams).toEqual([]);
  });
});
