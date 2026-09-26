// Feature: pool-referee-call-app, Property 5: Atomic Acknowledgement — Exactly-One Confluence

import { describe, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { CallRecord, TournamentRecord } from '@/lib/db/queries';
import { AlreadyClaimedError } from '@/lib/calls/errors';

// ---------------------------------------------------------------------------
// Mock @/lib/auth/tokens to avoid crypto dependency issues in test env
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth/tokens', () => ({
  generateToken: () => `mock-token`,
  hashToken: (t: string) => `sha256:${t}`,
  verifyToken: () => true,
}));

// ---------------------------------------------------------------------------
// Shared in-memory call record state
// ---------------------------------------------------------------------------

let sharedCallRecord: CallRecord;
let claimed: boolean;

const activeTournament: TournamentRecord = {
  tournamentId: 'tournament-1',
  name: 'Test Tournament',
  status: 'active',
  tableNumbers: [1, 2, 3, 4, 5],
  adminTokenHash: 'sha256:admin',
  refereeTokenHash: 'sha256:referee',
  playerTokenHash: 'sha256:player',
  createdAt: '2025-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mock @/lib/db/queries — the AlreadyClaimedError class must be defined
// inline within the factory since vi.mock is hoisted.
// ---------------------------------------------------------------------------
vi.mock('@/lib/db/queries', () => {
  // Define the DB-layer AlreadyClaimedError inside the factory
  class MockAlreadyClaimedError extends Error {
    readonly code = 'ALREADY_CLAIMED' as const;
    constructor() {
      super('This call was already claimed by another referee.');
      this.name = 'AlreadyClaimedError';
    }
  }

  return {
    getTournamentMeta: vi.fn(async () => activeTournament),
    getCall: vi.fn(async () => sharedCallRecord),
    updateCallAcknowledge: vi.fn(async () => {
      // Simulate atomic DynamoDB TransactWriteItems conditional check:
      // Only the first caller succeeds; all subsequent callers get AlreadyClaimedError.
      if (!claimed) {
        claimed = true;
        sharedCallRecord = { ...sharedCallRecord, status: 'acknowledged' };
        return;
      }
      throw new MockAlreadyClaimedError();
    }),
    putCall: vi.fn(),
    queryUnansweredQueue: vi.fn(async () => []),
    queryAllTournamentItems: vi.fn(async () => ({
      tournament: activeTournament,
      calls: [],
      referees: [],
      teams: [],
      sessions: [],
    })),
    queryRefereeQueue: vi.fn(async () => []),
    updateCallComplete: vi.fn(),
    AlreadyClaimedError: MockAlreadyClaimedError,
  };
});

// Import acknowledgeCall AFTER mocks are set up
import { acknowledgeCall } from '@/lib/calls/manager';

/**
 * **Validates: Requirements 7.2, 7.3**
 *
 * For any set of N concurrent acknowledge requests (N ≥ 2) targeting the same
 * call with status = "unanswered", exactly 1 request SHALL receive a success
 * response (transitioning the call to "acknowledged") and all remaining N-1
 * requests SHALL receive an AlreadyClaimedError, regardless of request arrival order.
 */
describe('Property 5: Atomic Acknowledgement — Exactly-One Confluence', () => {
  beforeEach(() => {
    sharedCallRecord = {
      callId: 'call-1',
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      teamName: 'Test Team',
      tableNumber: 3,
      status: 'unanswered',
      refereeId: null,
      refereeName: null,
      createdAt: '2025-01-01T10:00:00.000Z',
      acknowledgedAt: null,
      completedAt: null,
      cancelledAt: null,
    };
    claimed = false;
  });

  it('exactly 1 concurrent acknowledge succeeds and N-1 throw AlreadyClaimedError', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate N concurrent referees (between 2 and 10)
        fc.integer({ min: 2, max: 10 }),
        async (n) => {
          // Reset state for each property test case
          sharedCallRecord = {
            callId: 'call-1',
            tournamentId: 'tournament-1',
            teamId: 'team-1',
            teamName: 'Test Team',
            tableNumber: 3,
            status: 'unanswered',
            refereeId: null,
            refereeName: null,
            createdAt: '2025-01-01T10:00:00.000Z',
            acknowledgedAt: null,
            completedAt: null,
            cancelledAt: null,
          };
          claimed = false;

          // Generate N unique referee IDs
          const refereeIds = Array.from({ length: n }, (_, i) => `ref-${i + 1}`);

          // Simulate N concurrent acknowledge requests using Promise.allSettled
          const results = await Promise.allSettled(
            refereeIds.map((refId) =>
              acknowledgeCall(
                'call-1',
                refId,
                `Referee ${refId}`,
                'tournament-1',
              ),
            ),
          );

          // Count fulfilled (success) and rejected (AlreadyClaimedError) outcomes
          const fulfilled = results.filter(
            (r) => r.status === 'fulfilled',
          );
          const rejected = results.filter(
            (r) => r.status === 'rejected',
          );

          // PROPERTY: Exactly 1 success
          if (fulfilled.length !== 1) {
            return false;
          }

          // PROPERTY: Exactly N-1 failures
          if (rejected.length !== n - 1) {
            return false;
          }

          // PROPERTY: All rejections are AlreadyClaimedError
          for (const r of rejected) {
            if (r.status !== 'rejected') return false;
            const err = r.reason;
            if (!(err instanceof AlreadyClaimedError)) {
              return false;
            }
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
