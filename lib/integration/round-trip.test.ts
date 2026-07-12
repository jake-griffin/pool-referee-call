/**
 * Integration tests — full happy-path round trip and concurrent acknowledge.
 *
 * Uses an in-memory store to simulate DynamoDB's key-value patterns,
 * testing that createCall → acknowledgeCall → completeCall flow works
 * end-to-end with realistic data flow through the domain layer.
 *
 * Requirements: 2.1, 4.4, 5.4, 6.4, 7.2, 7.3, 8.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// In-memory store simulating DynamoDB single-table design
// ---------------------------------------------------------------------------

let store: Map<string, Record<string, unknown>>;

function storeKey(pk: string, sk: string): string {
  return `${pk}#${sk}`;
}

function resetStore(): void {
  store = new Map();
}

// ---------------------------------------------------------------------------
// Mock @/lib/auth/tokens
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/tokens', () => ({
  generateToken: () => crypto.randomUUID(),
  hashToken: (t: string) => `sha256:${t}`,
  verifyToken: (plain: string, stored: string) => `sha256:${plain}` === stored,
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db/queries with an in-memory implementation
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/queries', () => {
  // Helper key constructors
  const pk = (tournamentId: string) => `T#${tournamentId}`;
  const metaSK = () => 'META';
  const callSK = (callId: string) => `CALL#${callId}`;
  const refSK = (refereeId: string) => `REF#${refereeId}`;
  const teamSK = (teamId: string) => `TEAM#${teamId}`;
  const sessionSK = (sessionId: string) => `SESSION#${sessionId}`;

  class AlreadyClaimedError extends Error {
    readonly code = 'ALREADY_CLAIMED' as const;
    constructor() {
      super('This call was already claimed by another referee.');
      this.name = 'AlreadyClaimedError';
    }
  }

  return {
    AlreadyClaimedError,

    getTournamentMeta: vi.fn(async (tournamentId: string) => {
      const key = storeKey(pk(tournamentId), metaSK());
      const item = store.get(key);
      if (!item) return null;
      return item;
    }),

    putTournament: vi.fn(async (record: Record<string, unknown>) => {
      const key = storeKey(pk(record.tournamentId as string), metaSK());
      store.set(key, { ...record });
    }),

    putReferee: vi.fn(async (record: Record<string, unknown>) => {
      const key = storeKey(pk(record.tournamentId as string), refSK(record.refereeId as string));
      store.set(key, { ...record });
    }),

    putTeam: vi.fn(async (record: Record<string, unknown>) => {
      const key = storeKey(pk(record.tournamentId as string), teamSK(record.teamId as string));
      store.set(key, { ...record });
    }),

    putSession: vi.fn(async (record: Record<string, unknown>) => {
      const key = storeKey(pk(record.tournamentId as string), sessionSK(record.sessionId as string));
      store.set(key, { ...record });
    }),

    getSession: vi.fn(async (tournamentId: string, sessionId: string) => {
      const key = storeKey(pk(tournamentId), sessionSK(sessionId));
      return store.get(key) ?? null;
    }),

    getCall: vi.fn(async (tournamentId: string, callId: string) => {
      const key = storeKey(pk(tournamentId), callSK(callId));
      const item = store.get(key);
      if (!item) return null;
      return item;
    }),

    putCall: vi.fn(async (record: Record<string, unknown>) => {
      const key = storeKey(pk(record.tournamentId as string), callSK(record.callId as string));
      store.set(key, {
        ...record,
        GSI1PK: `T#${record.tournamentId}#UNANSWERED`,
        GSI1SK: record.createdAt,
      });
    }),

    updateCallAcknowledge: vi.fn(async (
      tournamentId: string,
      callId: string,
      refereeId: string,
      refereeName: string,
      acknowledgedAt: string,
    ) => {
      const key = storeKey(pk(tournamentId), callSK(callId));
      const item = store.get(key);
      if (!item || item.status !== 'unanswered') {
        throw new AlreadyClaimedError();
      }
      // Atomic transition: unanswered → acknowledged
      store.set(key, {
        ...item,
        status: 'acknowledged',
        refereeId,
        refereeName,
        acknowledgedAt,
        GSI1PK: `T#${tournamentId}#REF#${refereeId}`,
        GSI1SK: acknowledgedAt,
      });
    }),

    updateCallComplete: vi.fn(async (
      tournamentId: string,
      callId: string,
      refereeId: string,
      completedAt: string,
    ) => {
      const key = storeKey(pk(tournamentId), callSK(callId));
      const item = store.get(key);
      if (!item || item.status !== 'acknowledged' || item.refereeId !== refereeId) {
        throw new Error('Condition check failed');
      }
      store.set(key, {
        ...item,
        status: 'completed',
        completedAt,
        GSI1PK: undefined,
        GSI1SK: undefined,
      });
    }),

    queryUnansweredQueue: vi.fn(async (tournamentId: string) => {
      const prefix = `T#${tournamentId}#CALL#`;
      const results: Record<string, unknown>[] = [];
      for (const [key, item] of store.entries()) {
        if (
          key.startsWith(`T#${tournamentId}#CALL#`) &&
          item.status === 'unanswered'
        ) {
          results.push(item);
        }
      }
      // Sort by createdAt ascending (FIFO)
      results.sort((a, b) =>
        (a.createdAt as string).localeCompare(b.createdAt as string)
      );
      return results;
    }),

    queryRefereeQueue: vi.fn(async (tournamentId: string, refereeId: string) => {
      const results: Record<string, unknown>[] = [];
      for (const [, item] of store.entries()) {
        if (
          item.tournamentId === tournamentId &&
          item.status === 'acknowledged' &&
          item.refereeId === refereeId
        ) {
          results.push(item);
        }
      }
      results.sort((a, b) =>
        (a.acknowledgedAt as string).localeCompare(b.acknowledgedAt as string)
      );
      return results;
    }),

    queryAllTournamentItems: vi.fn(async (tournamentId: string) => {
      const result = {
        tournament: null as Record<string, unknown> | null,
        calls: [] as Record<string, unknown>[],
        referees: [] as Record<string, unknown>[],
        teams: [] as Record<string, unknown>[],
        sessions: [] as Record<string, unknown>[],
      };
      const pkPrefix = `T#${tournamentId}#`;
      for (const [key, item] of store.entries()) {
        if (!key.startsWith(`T#${tournamentId}#`)) continue;
        const sk = key.slice(pkPrefix.length);
        if (sk === 'META') {
          result.tournament = item;
        } else if (sk.startsWith('CALL#')) {
          result.calls.push(item);
        } else if (sk.startsWith('REF#')) {
          result.referees.push(item);
        } else if (sk.startsWith('TEAM#')) {
          result.teams.push(item);
        } else if (sk.startsWith('SESSION#')) {
          result.sessions.push(item);
        }
      }
      return result;
    }),
  };
});

// ---------------------------------------------------------------------------
// Import domain functions AFTER mocks are registered
// ---------------------------------------------------------------------------

import { createCall, acknowledgeCall, completeCall } from '@/lib/calls/manager';
import { putTournament, putReferee, putTeam } from '@/lib/db/queries';
import { AlreadyClaimedError } from '@/lib/calls/errors';

// ---------------------------------------------------------------------------
// 18.1 — Round-trip integration test
// ---------------------------------------------------------------------------

describe('Integration: full round-trip happy path', () => {
  const tournamentId = 'tourney-001';
  const refereeId = 'ref-001';
  const refereeName = 'Alice';
  const teamId = 'team-001';
  const teamName = 'Team Rocket';

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('creates tournament → joins referee & player → creates call → acknowledges → completes', async () => {
    // Step 1: Create tournament record directly in the store
    await putTournament({
      tournamentId,
      name: 'Spring Open 2025',
      status: 'active',
      tableNumbers: [11, 12, 13, 14, 15],
      adminTokenHash: 'sha256:admin-token',
      refereeTokenHash: 'sha256:ref-token',
      playerTokenHash: 'sha256:player-token',
      createdAt: '2025-01-01T10:00:00.000Z',
    });

    // Verify tournament is stored
    const tournamentKey = storeKey(`T#${tournamentId}`, 'META');
    expect(store.has(tournamentKey)).toBe(true);
    const storedTournament = store.get(tournamentKey);
    expect(storedTournament?.status).toBe('active');
    expect(storedTournament?.name).toBe('Spring Open 2025');

    // Step 2: Join as referee (putReferee simulates the join flow)
    await putReferee({
      refereeId,
      tournamentId,
      name: refereeName,
      joinedAt: '2025-01-01T10:01:00.000Z',
    });

    const refKey = storeKey(`T#${tournamentId}`, `REF#${refereeId}`);
    expect(store.has(refKey)).toBe(true);
    const storedRef = store.get(refKey);
    expect(storedRef?.name).toBe(refereeName);

    // Step 3: Join as player (putTeam simulates the join flow)
    await putTeam({
      teamId,
      tournamentId,
      name: teamName,
      joinedAt: '2025-01-01T10:02:00.000Z',
    });

    const teamKey = storeKey(`T#${tournamentId}`, `TEAM#${teamId}`);
    expect(store.has(teamKey)).toBe(true);
    const storedTeam = store.get(teamKey);
    expect(storedTeam?.name).toBe(teamName);

    // Step 4: Create a call
    const call = await createCall({
      tournamentId,
      teamId,
      teamName,
      tableNumber: 14,
    });

    expect(call.status).toBe('unanswered');
    expect(call.tournamentId).toBe(tournamentId);
    expect(call.teamId).toBe(teamId);
    expect(call.teamName).toBe(teamName);
    expect(call.tableNumber).toBe(14);
    expect(call.refereeId).toBeNull();
    expect(call.refereeName).toBeNull();
    expect(call.acknowledgedAt).toBeNull();
    expect(call.completedAt).toBeNull();

    // Verify call record is in the store with unanswered GSI1 attributes
    const callKey = storeKey(`T#${tournamentId}`, `CALL#${call.callId}`);
    const storedCall = store.get(callKey);
    expect(storedCall).toBeDefined();
    expect(storedCall?.status).toBe('unanswered');
    expect(storedCall?.GSI1PK).toBe(`T#${tournamentId}#UNANSWERED`);

    // Step 5: Acknowledge the call
    const acknowledged = await acknowledgeCall(
      call.callId,
      refereeId,
      refereeName,
      tournamentId,
    );

    expect(acknowledged.status).toBe('acknowledged');
    expect(acknowledged.refereeId).toBe(refereeId);
    expect(acknowledged.refereeName).toBe(refereeName);
    expect(acknowledged.acknowledgedAt).toBeTruthy();

    // Verify store reflects acknowledged state with referee GSI1 attributes
    const storedAcked = store.get(callKey);
    expect(storedAcked?.status).toBe('acknowledged');
    expect(storedAcked?.refereeId).toBe(refereeId);
    expect(storedAcked?.GSI1PK).toBe(`T#${tournamentId}#REF#${refereeId}`);

    // Step 6: Complete the call
    const completed = await completeCall(
      call.callId,
      refereeId,
      tournamentId,
    );

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();

    // Verify store reflects completed state with GSI1 attributes removed
    const storedCompleted = store.get(callKey);
    expect(storedCompleted?.status).toBe('completed');
    expect(storedCompleted?.GSI1PK).toBeUndefined();
    expect(storedCompleted?.GSI1SK).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 18.2 — Concurrent acknowledge integration test
// ---------------------------------------------------------------------------

describe('Integration: concurrent acknowledge — exactly one success', () => {
  const tournamentId = 'tourney-002';

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('exactly one referee succeeds and the other receives AlreadyClaimedError', async () => {
    // Setup: create tournament and a call in unanswered state
    await putTournament({
      tournamentId,
      name: 'Concurrent Test Tournament',
      status: 'active',
      tableNumbers: [1, 2, 3, 4, 5],
      adminTokenHash: 'sha256:admin',
      refereeTokenHash: 'sha256:referee',
      playerTokenHash: 'sha256:player',
      createdAt: '2025-01-01T10:00:00.000Z',
    });

    // Create a call via domain function
    const call = await createCall({
      tournamentId,
      teamId: 'team-x',
      teamName: 'Team X',
      tableNumber: 3,
    });

    expect(call.status).toBe('unanswered');

    // Two referees simultaneously try to acknowledge the same call
    const referee1Promise = acknowledgeCall(call.callId, 'ref-A', 'Referee A', tournamentId);
    const referee2Promise = acknowledgeCall(call.callId, 'ref-B', 'Referee B', tournamentId);

    // Settle both promises
    const results = await Promise.allSettled([referee1Promise, referee2Promise]);

    // Count successes and failures
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Exactly one should succeed
    expect(successes).toHaveLength(1);
    // Exactly one should fail with AlreadyClaimedError
    expect(failures).toHaveLength(1);

    const failedResult = failures[0] as PromiseRejectedResult;
    expect(failedResult.reason).toBeInstanceOf(AlreadyClaimedError);
    expect(failedResult.reason.code).toBe('ALREADY_CLAIMED');

    // Verify the call is in acknowledged state in the store
    const callKey = storeKey(`T#${tournamentId}`, `CALL#${call.callId}`);
    const storedCall = store.get(callKey);
    expect(storedCall?.status).toBe('acknowledged');
    // The referee who won should be stored
    expect(['ref-A', 'ref-B']).toContain(storedCall?.refereeId);
  });

  it('with multiple concurrent referees, exactly one succeeds and all others fail', async () => {
    // Setup tournament
    await putTournament({
      tournamentId,
      name: 'Multi-Concurrent Test',
      status: 'active',
      tableNumbers: [1, 2, 3],
      adminTokenHash: 'sha256:admin',
      refereeTokenHash: 'sha256:referee',
      playerTokenHash: 'sha256:player',
      createdAt: '2025-01-01T10:00:00.000Z',
    });

    // Create a call
    const call = await createCall({
      tournamentId,
      teamId: 'team-y',
      teamName: 'Team Y',
      tableNumber: 2,
    });

    // 5 referees all try to acknowledge simultaneously
    const refereeCount = 5;
    const promises = Array.from({ length: refereeCount }, (_, i) =>
      acknowledgeCall(call.callId, `ref-${i}`, `Referee ${i}`, tournamentId)
    );

    const results = await Promise.allSettled(promises);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Exactly 1 success, N-1 failures
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(refereeCount - 1);

    // All failures should be AlreadyClaimedError
    for (const failure of failures) {
      const rejected = failure as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(AlreadyClaimedError);
    }

    // Verify final state
    const callKey = storeKey(`T#${tournamentId}`, `CALL#${call.callId}`);
    const storedCall = store.get(callKey);
    expect(storedCall?.status).toBe('acknowledged');
  });
});
