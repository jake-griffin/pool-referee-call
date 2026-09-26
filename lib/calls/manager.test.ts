/**
 * Unit tests for lib/calls/manager.ts (Call_Manager)
 *
 * Tests cover domain error mapping for createCall, acknowledgeCall, and completeCall.
 *
 * Requirements: 6.2, 6.3, 7.3, 8.3, 13.2, 13.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CallRecord, TournamentRecord, AllTournamentItems } from '@/lib/db/queries';

// ---------------------------------------------------------------------------
// Mock @/lib/auth/tokens to avoid crypto dependency issues in test env
// ---------------------------------------------------------------------------
let tokenCounter = 0;
vi.mock('@/lib/auth/tokens', () => ({
  generateToken: () => `mock-token-${tokenCounter++}`,
  hashToken: (t: string) => `sha256:${t}`,
  verifyToken: () => true,
}));

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

let mockTournament: TournamentRecord | null = null;
let mockCall: CallRecord | null = null;
let mockUnansweredCalls: CallRecord[] = [];
let mockAllItems: AllTournamentItems = {
  tournament: null,
  calls: [],
  referees: [],
  teams: [],
  sessions: [],
};
let mockAcknowledgeError: Error | null = null;

// ---------------------------------------------------------------------------
// Mock @/lib/db/queries
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/queries', () => ({
  getTournamentMeta: vi.fn(async () => mockTournament),
  getCall: vi.fn(async () => mockCall),
  putCall: vi.fn(async () => {}),
  updateCallAcknowledge: vi.fn(async () => {
    if (mockAcknowledgeError) {
      throw mockAcknowledgeError;
    }
  }),
  updateCallComplete: vi.fn(async () => {}),
  updateCallCancel: vi.fn(async () => {}),
  queryUnansweredQueue: vi.fn(async () => mockUnansweredCalls),
  queryAllTournamentItems: vi.fn(async () => mockAllItems),
  queryRefereeQueue: vi.fn(async () => []),
  AlreadyClaimedError: class AlreadyClaimedError extends Error {
    readonly code = 'ALREADY_CLAIMED' as const;
    constructor() {
      super('Already claimed');
      this.name = 'AlreadyClaimedError';
    }
  },
}));

// Import after mocks are set up
import {
  createCall,
  acknowledgeCall,
  completeCall,
  cancelCall,
  completeCallAsAdmin,
} from '@/lib/calls/manager';
import {
  TournamentClosedError,
  InvalidTableError,
  MaxCallsError,
  AlreadyClaimedError,
  WrongRefereeError,
  WrongStatusError,
} from '@/lib/calls/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActiveTournament(overrides?: Partial<TournamentRecord>): TournamentRecord {
  return {
    tournamentId: 'tournament-1',
    name: 'Test Tournament',
    status: 'active',
    tableNumbers: [1, 2, 3, 4, 5],
    adminTokenHash: 'sha256:admin',
    refereeTokenHash: 'sha256:referee',
    playerTokenHash: 'sha256:player',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCall(overrides?: Partial<CallRecord>): CallRecord {
  return {
    callId: 'call-1',
    tournamentId: 'tournament-1',
    teamId: 'team-1',
    teamName: 'Team One',
    tableNumber: 1,
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

// ---------------------------------------------------------------------------
// createCall
// ---------------------------------------------------------------------------

describe('createCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenCounter = 0;
    mockTournament = makeActiveTournament();
    mockCall = null;
    mockUnansweredCalls = [];
    mockAllItems = {
      tournament: mockTournament,
      calls: [],
      referees: [],
      teams: [],
      sessions: [],
    };
    mockAcknowledgeError = null;
  });

  it('throws InvalidTableError when tableNumber is not in tournament.tableNumbers', async () => {
    // Table 99 is not in [1,2,3,4,5]
    try {
      await createCall({
        tournamentId: 'tournament-1',
        teamId: 'team-1',
        teamName: 'Team One',
        tableNumber: 99,
      });
      expect.fail('Expected InvalidTableError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTableError);
      expect((err as InvalidTableError).code).toBe('INVALID_TABLE');
    }
  });

  it('throws MaxCallsError when team already has 2 active calls', async () => {
    // Set up 2 active calls for team-1
    const existingCalls: CallRecord[] = [
      makeCall({ callId: 'call-a', status: 'unanswered', teamId: 'team-1' }),
      makeCall({ callId: 'call-b', status: 'acknowledged', teamId: 'team-1', refereeId: 'ref-1' }),
    ];
    mockUnansweredCalls = existingCalls.filter((c) => c.status === 'unanswered');
    mockAllItems = {
      tournament: mockTournament,
      calls: existingCalls,
      referees: [],
      teams: [],
      sessions: [],
    };

    try {
      await createCall({
        tournamentId: 'tournament-1',
        teamId: 'team-1',
        teamName: 'Team One',
        tableNumber: 1,
      });
      expect.fail('Expected MaxCallsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MaxCallsError);
      expect((err as MaxCallsError).code).toBe('MAX_CALLS');
    }
  });

  it('throws TournamentClosedError when tournament.status is closed', async () => {
    mockTournament = makeActiveTournament({ status: 'closed' });

    try {
      await createCall({
        tournamentId: 'tournament-1',
        teamId: 'team-1',
        teamName: 'Team One',
        tableNumber: 1,
      });
      expect.fail('Expected TournamentClosedError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TournamentClosedError);
      expect((err as TournamentClosedError).code).toBe('TOURNAMENT_CLOSED');
    }
  });
});

// ---------------------------------------------------------------------------
// acknowledgeCall
// ---------------------------------------------------------------------------

describe('acknowledgeCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenCounter = 0;
    mockTournament = makeActiveTournament();
    mockCall = makeCall({ status: 'unanswered' });
    mockUnansweredCalls = [];
    mockAllItems = {
      tournament: mockTournament,
      calls: [],
      referees: [],
      teams: [],
      sessions: [],
    };
    mockAcknowledgeError = null;
  });

  it('throws AlreadyClaimedError when updateCallAcknowledge throws DB-layer AlreadyClaimedError', async () => {
    // Simulate DB layer AlreadyClaimedError (from the mocked module)
    const { AlreadyClaimedError: DbAlreadyClaimedError } = await import('@/lib/db/queries');
    mockAcknowledgeError = new DbAlreadyClaimedError();

    try {
      await acknowledgeCall('call-1', 'ref-1', 'Alice', 'tournament-1');
      expect.fail('Expected AlreadyClaimedError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AlreadyClaimedError);
      expect((err as AlreadyClaimedError).code).toBe('ALREADY_CLAIMED');
    }
  });

  it('throws TournamentClosedError when tournament is closed', async () => {
    mockTournament = makeActiveTournament({ status: 'closed' });

    try {
      await acknowledgeCall('call-1', 'ref-1', 'Alice', 'tournament-1');
      expect.fail('Expected TournamentClosedError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TournamentClosedError);
      expect((err as TournamentClosedError).code).toBe('TOURNAMENT_CLOSED');
    }
  });
});

// ---------------------------------------------------------------------------
// completeCall
// ---------------------------------------------------------------------------

describe('completeCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenCounter = 0;
    mockTournament = makeActiveTournament();
    mockCall = makeCall({
      status: 'acknowledged',
      refereeId: 'ref-1',
      refereeName: 'Alice',
      acknowledgedAt: '2025-01-01T10:05:00.000Z',
    });
    mockUnansweredCalls = [];
    mockAllItems = {
      tournament: mockTournament,
      calls: [],
      referees: [],
      teams: [],
      sessions: [],
    };
    mockAcknowledgeError = null;
  });

  it('throws WrongRefereeError when refereeId does not match call.refereeId', async () => {
    // Call is acknowledged by ref-1, but ref-2 tries to complete
    try {
      await completeCall('call-1', 'ref-2', 'tournament-1');
      expect.fail('Expected WrongRefereeError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WrongRefereeError);
      expect((err as WrongRefereeError).code).toBe('WRONG_REFEREE');
    }
  });

  it('throws WrongStatusError when call status is not acknowledged', async () => {
    // Call is still unanswered
    mockCall = makeCall({ status: 'unanswered' });

    try {
      await completeCall('call-1', 'ref-1', 'tournament-1');
      expect.fail('Expected WrongStatusError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WrongStatusError);
      expect((err as WrongStatusError).code).toBe('WRONG_STATUS');
    }
  });

  it('throws TournamentClosedError when tournament is closed', async () => {
    mockTournament = makeActiveTournament({ status: 'closed' });

    try {
      await completeCall('call-1', 'ref-1', 'tournament-1');
      expect.fail('Expected TournamentClosedError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TournamentClosedError);
      expect((err as TournamentClosedError).code).toBe('TOURNAMENT_CLOSED');
    }
  });
});

// ---------------------------------------------------------------------------
// cancelCall
// ---------------------------------------------------------------------------

describe('cancelCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenCounter = 0;
    mockTournament = makeActiveTournament();
    mockCall = null;
    mockUnansweredCalls = [];
    mockAcknowledgeError = null;
  });

  it('cancels an unanswered call', async () => {
    mockCall = makeCall({ status: 'unanswered' });
    const result = await cancelCall('call-1', 'tournament-1');
    expect(result.status).toBe('cancelled');
    expect(result.cancelledAt).toBeTruthy();
  });

  it('cancels an acknowledged call', async () => {
    mockCall = makeCall({ status: 'acknowledged', refereeId: 'ref-1', refereeName: 'Al' });
    const result = await cancelCall('call-1', 'tournament-1');
    expect(result.status).toBe('cancelled');
  });

  it('rejects cancelling a completed call (WrongStatusError)', async () => {
    mockCall = makeCall({ status: 'completed', completedAt: '2025-01-01T11:00:00.000Z' });
    await expect(cancelCall('call-1', 'tournament-1')).rejects.toBeInstanceOf(WrongStatusError);
  });

  it('rejects when expectedTeamId does not match the call team (WrongRefereeError)', async () => {
    mockCall = makeCall({ status: 'unanswered', teamId: 'team-1' });
    await expect(
      cancelCall('call-1', 'tournament-1', { expectedTeamId: 'team-OTHER' }),
    ).rejects.toBeInstanceOf(WrongRefereeError);
  });

  it('allows cancel when expectedTeamId matches', async () => {
    mockCall = makeCall({ status: 'unanswered', teamId: 'team-1' });
    const result = await cancelCall('call-1', 'tournament-1', { expectedTeamId: 'team-1' });
    expect(result.status).toBe('cancelled');
  });

  it('rejects when the tournament is closed', async () => {
    mockTournament = makeActiveTournament({ status: 'closed' });
    mockCall = makeCall({ status: 'unanswered' });
    await expect(cancelCall('call-1', 'tournament-1')).rejects.toBeInstanceOf(TournamentClosedError);
  });
});

// ---------------------------------------------------------------------------
// completeCallAsAdmin
// ---------------------------------------------------------------------------

describe('completeCallAsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenCounter = 0;
    mockTournament = makeActiveTournament();
    mockCall = null;
  });

  it('completes an acknowledged call without a referee-ownership check', async () => {
    mockCall = makeCall({
      status: 'acknowledged',
      refereeId: 'ref-1',
      refereeName: 'Al',
      acknowledgedAt: '2025-01-01T10:05:00.000Z',
    });
    const result = await completeCallAsAdmin('call-1', 'tournament-1');
    expect(result.status).toBe('completed');
    expect(result.completedAt).toBeTruthy();
  });

  it('rejects completing a non-acknowledged call (WrongStatusError)', async () => {
    mockCall = makeCall({ status: 'unanswered' });
    await expect(completeCallAsAdmin('call-1', 'tournament-1')).rejects.toBeInstanceOf(
      WrongStatusError,
    );
  });
});
