/**
 * Unit tests for lib/db/queries.ts
 *
 * Tests cover:
 *  - getTournamentMeta returns null for missing items
 *  - updateCallAcknowledge maps TransactionCanceledException → AlreadyClaimedError
 *  - getTournamentState assembles the full response shape correctly
 *
 * Requirements: 7.3, 9.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DynamoDB client module before importing queries
vi.mock('@/lib/db/client', () => ({
  getDocumentClient: vi.fn(),
  TABLE_NAME: 'TestTable',
  GSI1_NAME: 'GSI1',
}));

// Mock the queue position module
vi.mock('@/lib/queue/position', () => ({
  assignPositions: vi.fn((queue: Array<{ callId: string; teamId: string; teamName: string; tableNumber: number; acknowledgedAt: string }>) =>
    queue
      .sort((a, b) => a.acknowledgedAt.localeCompare(b.acknowledgedAt))
      .map((entry, idx) => ({ ...entry, position: idx + 1 })),
  ),
}));

import { getDocumentClient } from '@/lib/db/client';
import {
  getTournamentMeta,
  updateCallAcknowledge,
  getTournamentState,
  listTournaments,
  AlreadyClaimedError,
} from '@/lib/db/queries';
import type { SessionPayload } from '@/lib/auth/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  const mockSend = vi.fn();
  (getDocumentClient as ReturnType<typeof vi.fn>).mockReturnValue({
    send: mockSend,
  });
  return mockSend;
}

// ---------------------------------------------------------------------------
// getTournamentMeta
// ---------------------------------------------------------------------------

describe('getTournamentMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the tournament item does not exist', async () => {
    const mockSend = createMockClient();
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await getTournamentMeta('nonexistent-id');

    expect(result).toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns null when GetItem returns an empty response (no Item key)', async () => {
    const mockSend = createMockClient();
    mockSend.mockResolvedValueOnce({});

    const result = await getTournamentMeta('missing-tournament');

    expect(result).toBeNull();
  });

  it('returns a typed TournamentRecord when the item exists', async () => {
    const mockSend = createMockClient();
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'T#t_123',
        SK: 'META',
        tournamentId: 't_123',
        name: 'Spring Open',
        status: 'active',
        tableNumbers: [11, 12, 13],
        adminTokenHash: 'sha256:aaa',
        refereeTokenHash: 'sha256:bbb',
        playerTokenHash: 'sha256:ccc',
        createdAt: '2025-01-01T10:00:00.000Z',
      },
    });

    const result = await getTournamentMeta('t_123');

    expect(result).toEqual({
      tournamentId: 't_123',
      name: 'Spring Open',
      status: 'active',
      tableNumbers: [11, 12, 13],
      adminTokenHash: 'sha256:aaa',
      refereeTokenHash: 'sha256:bbb',
      playerTokenHash: 'sha256:ccc',
      createdAt: '2025-01-01T10:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------
// updateCallAcknowledge
// ---------------------------------------------------------------------------

describe('updateCallAcknowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws AlreadyClaimedError when TransactionCanceledException is raised', async () => {
    const mockSend = createMockClient();

    // Simulate TransactionCanceledException by creating an error with the right name
    const txError = new Error('Transaction cancelled');
    txError.name = 'TransactionCanceledException';
    mockSend.mockRejectedValueOnce(txError);

    await expect(
      updateCallAcknowledge(
        'tournament-1',
        'call-1',
        'ref-1',
        'Alice',
        '2025-01-01T10:05:00.000Z',
      ),
    ).rejects.toThrow(AlreadyClaimedError);
  });

  it('throws AlreadyClaimedError with the expected user-facing message', async () => {
    const mockSend = createMockClient();

    const txError = new Error('Transaction cancelled');
    txError.name = 'TransactionCanceledException';
    mockSend.mockRejectedValueOnce(txError);

    await expect(
      updateCallAcknowledge(
        'tournament-1',
        'call-1',
        'ref-1',
        'Alice',
        '2025-01-01T10:05:00.000Z',
      ),
    ).rejects.toThrow('This call was already claimed by another referee.');
  });

  it('throws AlreadyClaimedError with the correct code property', async () => {
    const mockSend = createMockClient();

    const txError = new Error('Transaction cancelled');
    txError.name = 'TransactionCanceledException';
    mockSend.mockRejectedValueOnce(txError);

    try {
      await updateCallAcknowledge(
        'tournament-1',
        'call-1',
        'ref-1',
        'Alice',
        '2025-01-01T10:05:00.000Z',
      );
      // Should not reach here
      expect.fail('Expected AlreadyClaimedError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AlreadyClaimedError);
      expect((err as AlreadyClaimedError).code).toBe('ALREADY_CLAIMED');
    }
  });

  it('re-throws non-TransactionCanceledException errors as-is', async () => {
    const mockSend = createMockClient();

    const genericError = new Error('Network timeout');
    mockSend.mockRejectedValueOnce(genericError);

    await expect(
      updateCallAcknowledge(
        'tournament-1',
        'call-1',
        'ref-1',
        'Alice',
        '2025-01-01T10:05:00.000Z',
      ),
    ).rejects.toThrow('Network timeout');

    // Should NOT be an AlreadyClaimedError
    try {
      mockSend.mockRejectedValueOnce(new Error('Something else'));
      await updateCallAcknowledge(
        'tournament-1',
        'call-1',
        'ref-1',
        'Alice',
        '2025-01-01T10:05:00.000Z',
      );
    } catch (err) {
      expect(err).not.toBeInstanceOf(AlreadyClaimedError);
    }
  });

  it('succeeds silently when the transaction completes without error', async () => {
    const mockSend = createMockClient();
    mockSend.mockResolvedValueOnce({});

    await expect(
      updateCallAcknowledge(
        'tournament-1',
        'call-1',
        'ref-1',
        'Alice',
        '2025-01-01T10:05:00.000Z',
      ),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTournamentState
// ---------------------------------------------------------------------------

describe('getTournamentState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles the full TournamentStateResponse shape correctly', async () => {
    const mockSend = createMockClient();

    const tournamentId = 't_state_1';
    const session: SessionPayload = {
      sessionId: 'sess-1',
      tournamentId,
      role: 'player',
      entityId: 'team-1',
      displayName: 'Team Rocket',
      expiresAt: '2025-12-31T23:59:59.000Z',
    };

    // Call 1: queryAllTournamentItems — base table query (PK = T#{id})
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `T#${tournamentId}`,
          SK: 'META',
          tournamentId,
          name: 'Spring Open',
          status: 'active',
          tableNumbers: [11, 12, 13, 14],
          adminTokenHash: 'sha256:aaa',
          refereeTokenHash: 'sha256:bbb',
          playerTokenHash: 'sha256:ccc',
          createdAt: '2025-01-01T10:00:00.000Z',
        },
        {
          PK: `T#${tournamentId}`,
          SK: 'REF#ref-1',
          refereeId: 'ref-1',
          tournamentId,
          name: 'Alice',
          joinedAt: '2025-01-01T10:01:00.000Z',
        },
        {
          PK: `T#${tournamentId}`,
          SK: 'TEAM#team-1',
          teamId: 'team-1',
          tournamentId,
          name: 'Team Rocket',
          joinedAt: '2025-01-01T10:02:00.000Z',
        },
        {
          PK: `T#${tournamentId}`,
          SK: 'CALL#call-1',
          callId: 'call-1',
          tournamentId,
          teamId: 'team-1',
          teamName: 'Team Rocket',
          tableNumber: 11,
          status: 'unanswered',
          refereeId: null,
          refereeName: null,
          createdAt: '2025-01-01T10:03:00.000Z',
          acknowledgedAt: null,
          completedAt: null,
        },
        {
          PK: `T#${tournamentId}`,
          SK: 'CALL#call-2',
          callId: 'call-2',
          tournamentId,
          teamId: 'team-1',
          teamName: 'Team Rocket',
          tableNumber: 12,
          status: 'acknowledged',
          refereeId: 'ref-1',
          refereeName: 'Alice',
          createdAt: '2025-01-01T10:03:30.000Z',
          acknowledgedAt: '2025-01-01T10:04:00.000Z',
          completedAt: null,
        },
      ],
    });

    // Call 2: queryUnansweredQueue — GSI1 query for unanswered calls
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `T#${tournamentId}`,
          SK: 'CALL#call-1',
          callId: 'call-1',
          tournamentId,
          teamId: 'team-1',
          teamName: 'Team Rocket',
          tableNumber: 11,
          status: 'unanswered',
          refereeId: null,
          refereeName: null,
          createdAt: '2025-01-01T10:03:00.000Z',
          acknowledgedAt: null,
          completedAt: null,
          GSI1PK: `T#${tournamentId}#UNANSWERED`,
          GSI1SK: '2025-01-01T10:03:00.000Z',
        },
      ],
    });

    // Call 3: queryRefereeQueue for ref-1 (GSI1 per-referee query)
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `T#${tournamentId}`,
          SK: 'CALL#call-2',
          callId: 'call-2',
          tournamentId,
          teamId: 'team-1',
          teamName: 'Team Rocket',
          tableNumber: 12,
          status: 'acknowledged',
          refereeId: 'ref-1',
          refereeName: 'Alice',
          createdAt: '2025-01-01T10:03:30.000Z',
          acknowledgedAt: '2025-01-01T10:04:00.000Z',
          completedAt: null,
          GSI1PK: `T#${tournamentId}#REF#ref-1`,
          GSI1SK: '2025-01-01T10:04:00.000Z',
        },
      ],
    });

    const result = await getTournamentState(tournamentId, session);

    // Verify the response shape has all required top-level keys
    expect(result).toHaveProperty('lastUpdatedAt');
    expect(result).toHaveProperty('tournament');
    expect(result).toHaveProperty('unansweredQueue');
    expect(result).toHaveProperty('refereeQueues');
    expect(result).toHaveProperty('myCalls');

    // Verify tournament info
    expect(result.tournament).toEqual({
      name: 'Spring Open',
      status: 'active',
      tableNumbers: [11, 12, 13, 14],
    });

    // Verify lastUpdatedAt is a valid ISO 8601 timestamp
    expect(new Date(result.lastUpdatedAt).toISOString()).toBe(
      result.lastUpdatedAt,
    );

    // Verify unanswered queue
    expect(result.unansweredQueue).toHaveLength(1);
    expect(result.unansweredQueue[0]).toMatchObject({
      callId: 'call-1',
      teamName: 'Team Rocket',
      tableNumber: 11,
      createdAt: '2025-01-01T10:03:00.000Z',
    });
    expect(result.unansweredQueue[0].elapsedSeconds).toBeGreaterThanOrEqual(0);

    // Verify referee queues
    expect(result.refereeQueues).toHaveProperty('ref-1');
    expect(result.refereeQueues['ref-1'].refereeName).toBe('Alice');
    expect(result.refereeQueues['ref-1'].calls).toHaveLength(1);
    expect(result.refereeQueues['ref-1'].calls[0]).toMatchObject({
      callId: 'call-2',
      teamName: 'Team Rocket',
      tableNumber: 12,
      acknowledgedAt: '2025-01-01T10:04:00.000Z',
      position: 1,
    });
    expect(
      result.refereeQueues['ref-1'].calls[0].elapsedSeconds,
    ).toBeGreaterThanOrEqual(0);

    // Verify myCalls for the player session (team-1's active calls)
    expect(result.myCalls).toHaveLength(2);
    const unansweredMyCall = result.myCalls.find((c) => c.callId === 'call-1');
    const acknowledgedMyCall = result.myCalls.find(
      (c) => c.callId === 'call-2',
    );
    expect(unansweredMyCall).toMatchObject({
      callId: 'call-1',
      tableNumber: 11,
      status: 'unanswered',
      refereeName: null,
      position: null,
    });
    expect(acknowledgedMyCall).toMatchObject({
      callId: 'call-2',
      tableNumber: 12,
      status: 'acknowledged',
      refereeName: 'Alice',
      position: 1,
    });
  });

  it('throws an error when the tournament does not exist', async () => {
    const mockSend = createMockClient();

    const session: SessionPayload = {
      sessionId: 'sess-1',
      tournamentId: 'missing-tournament',
      role: 'admin',
      entityId: 'admin-1',
      displayName: 'Admin',
      expiresAt: '2025-12-31T23:59:59.000Z',
    };

    // Base-table query returns no META record
    mockSend.mockResolvedValueOnce({ Items: [] });

    await expect(
      getTournamentState('missing-tournament', session),
    ).rejects.toThrow('Tournament missing-tournament not found');
  });

  it('returns empty myCalls for admin sessions', async () => {
    const mockSend = createMockClient();

    const tournamentId = 't_admin_1';
    const session: SessionPayload = {
      sessionId: 'sess-admin',
      tournamentId,
      role: 'admin',
      entityId: 'admin-1',
      displayName: 'Admin',
      expiresAt: '2025-12-31T23:59:59.000Z',
    };

    // Base-table query: just META, no calls
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `T#${tournamentId}`,
          SK: 'META',
          tournamentId,
          name: 'Admin Test',
          status: 'active',
          tableNumbers: [1, 2],
          adminTokenHash: 'sha256:x',
          refereeTokenHash: 'sha256:y',
          playerTokenHash: 'sha256:z',
          createdAt: '2025-01-01T10:00:00.000Z',
        },
      ],
    });

    // Unanswered queue: empty
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getTournamentState(tournamentId, session);

    expect(result.myCalls).toEqual([]);
    expect(result.unansweredQueue).toEqual([]);
    expect(result.refereeQueues).toEqual({});
  });

  it('returns referee own queue as myCalls for referee sessions', async () => {
    const mockSend = createMockClient();

    const tournamentId = 't_ref_1';
    const session: SessionPayload = {
      sessionId: 'sess-ref',
      tournamentId,
      role: 'referee',
      entityId: 'ref-1',
      displayName: 'Alice',
      expiresAt: '2025-12-31T23:59:59.000Z',
    };

    // Base-table query: META + 1 acknowledged call owned by ref-1
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `T#${tournamentId}`,
          SK: 'META',
          tournamentId,
          name: 'Ref Test',
          status: 'active',
          tableNumbers: [5, 6],
          adminTokenHash: 'sha256:a',
          refereeTokenHash: 'sha256:b',
          playerTokenHash: 'sha256:c',
          createdAt: '2025-01-01T10:00:00.000Z',
        },
        {
          PK: `T#${tournamentId}`,
          SK: 'REF#ref-1',
          refereeId: 'ref-1',
          tournamentId,
          name: 'Alice',
          joinedAt: '2025-01-01T10:01:00.000Z',
        },
        {
          PK: `T#${tournamentId}`,
          SK: 'CALL#call-r1',
          callId: 'call-r1',
          tournamentId,
          teamId: 'team-x',
          teamName: 'Team X',
          tableNumber: 5,
          status: 'acknowledged',
          refereeId: 'ref-1',
          refereeName: 'Alice',
          createdAt: '2025-01-01T10:02:00.000Z',
          acknowledgedAt: '2025-01-01T10:02:30.000Z',
          completedAt: null,
        },
      ],
    });

    // Unanswered queue: empty
    mockSend.mockResolvedValueOnce({ Items: [] });

    // Referee queue for ref-1
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: `T#${tournamentId}`,
          SK: 'CALL#call-r1',
          callId: 'call-r1',
          tournamentId,
          teamId: 'team-x',
          teamName: 'Team X',
          tableNumber: 5,
          status: 'acknowledged',
          refereeId: 'ref-1',
          refereeName: 'Alice',
          createdAt: '2025-01-01T10:02:00.000Z',
          acknowledgedAt: '2025-01-01T10:02:30.000Z',
          completedAt: null,
        },
      ],
    });

    const result = await getTournamentState(tournamentId, session);

    // Referee myCalls should contain their own acknowledged call
    expect(result.myCalls).toHaveLength(1);
    expect(result.myCalls[0]).toMatchObject({
      callId: 'call-r1',
      tableNumber: 5,
      status: 'acknowledged',
      position: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// listTournaments — must exclude non-tournament META records
// ---------------------------------------------------------------------------

describe('listTournaments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes the scan to tournament partitions (PK begins_with "T#")', async () => {
    const mockSend = createMockClient();
    mockSend.mockResolvedValueOnce({ Items: [] });

    await listTournaments();

    // The scan must filter on both SK = META and a T# PK prefix, otherwise
    // director (DIRECTOR#) and global session (GSESSION#) records — which also
    // use SK = "META" — leak into the tournament list as blank rows.
    const sentCommand = mockSend.mock.calls[0][0];
    const filter = sentCommand.input.FilterExpression as string;
    expect(filter).toContain('SK = :meta');
    expect(filter).toContain('begins_with(PK, :tpref)');
    expect(sentCommand.input.ExpressionAttributeValues[':tpref']).toBe('T#');
  });

  it('maps returned tournament items to typed records', async () => {
    const mockSend = createMockClient();
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'T#t_1',
          SK: 'META',
          tournamentId: 't_1',
          name: 'Cup',
          status: 'active',
          tableNumbers: [1, 2],
          adminTokenHash: 'sha256:a',
          refereeTokenHash: 'sha256:b',
          playerTokenHash: 'sha256:c',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await listTournaments();
    expect(result).toHaveLength(1);
    expect(result[0].tournamentId).toBe('t_1');
    expect(result[0].name).toBe('Cup');
  });
});
