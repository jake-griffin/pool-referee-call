// Feature: pool-referee-call-app, Property 4: Max Active Calls Invariant

import { describe, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
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
// In-memory call store and mocked DB layer
// ---------------------------------------------------------------------------

let inMemoryCalls: CallRecord[] = [];

const activeTournament: TournamentRecord = {
  tournamentId: 'tournament-1',
  name: 'Test Tournament',
  status: 'active',
  tableNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  adminTokenHash: 'sha256:admin',
  refereeTokenHash: 'sha256:referee',
  playerTokenHash: 'sha256:player',
  createdAt: '2025-01-01T00:00:00.000Z',
};

vi.mock('@/lib/db/queries', () => ({
  getTournamentMeta: vi.fn(async () => activeTournament),
  queryUnansweredQueue: vi.fn(async () =>
    inMemoryCalls.filter((c) => c.status === 'unanswered'),
  ),
  queryAllTournamentItems: vi.fn(async (): Promise<AllTournamentItems> => ({
    tournament: activeTournament,
    calls: inMemoryCalls,
    referees: [],
    teams: [],
    sessions: [],
  })),
  putCall: vi.fn(async (record: CallRecord) => {
    inMemoryCalls.push(record);
  }),
  getCall: vi.fn(async (_tid: string, callId: string) =>
    inMemoryCalls.find((c) => c.callId === callId) ?? null,
  ),
  updateCallAcknowledge: vi.fn(),
  updateCallComplete: vi.fn(),
  queryRefereeQueue: vi.fn(async () => []),
  AlreadyClaimedError: class extends Error {
    readonly code = 'ALREADY_CLAIMED' as const;
    constructor() {
      super('Already claimed');
      this.name = 'AlreadyClaimedError';
    }
  },
}));

// Import createCall AFTER mocks are set up
import { createCall } from '@/lib/calls/manager';
import { MaxCallsError } from '@/lib/calls/errors';

// ---------------------------------------------------------------------------
// Action type for the property test: either create a call or acknowledge one
// ---------------------------------------------------------------------------

type Action =
  | { type: 'createCall'; tableNumber: number }
  | { type: 'acknowledge'; index: number };

/**
 * **Validates: Requirements 6.3, 17.4**
 *
 * For any sequence of call creation attempts by a single team — regardless of
 * how many attempts are made or in what order — the count of that team's calls
 * in `unanswered` or `acknowledged` status SHALL never exceed 2 at any point.
 */
describe('Property 4: Max Active Calls Invariant', () => {
  beforeEach(() => {
    inMemoryCalls = [];
    tokenCounter = 0;
  });

  const actionArb: fc.Arbitrary<Action> = fc.oneof(
    // Create call with a random valid table number
    fc.integer({ min: 1, max: 10 }).map((tableNumber) => ({
      type: 'createCall' as const,
      tableNumber,
    })),
    // Acknowledge a call at a random index (will be clamped to valid range)
    fc.nat({ max: 99 }).map((index) => ({
      type: 'acknowledge' as const,
      index,
    })),
  );

  it('the count of active calls (unanswered + acknowledged) for a team never exceeds 2', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArb, { minLength: 1, maxLength: 30 }),
        async (actions) => {
          // Reset state for each test case
          inMemoryCalls = [];
          tokenCounter = 0;

          const teamId = 'team-1';
          const teamName = 'Test Team';
          const tournamentId = 'tournament-1';

          for (const action of actions) {
            if (action.type === 'createCall') {
              try {
                await createCall({
                  tournamentId,
                  teamId,
                  teamName,
                  tableNumber: action.tableNumber,
                });
              } catch (err) {
                // MaxCallsError is expected when limit is reached
                if (!(err instanceof MaxCallsError)) {
                  throw err;
                }
              }
            } else {
              // Acknowledge: transition a random unanswered call to acknowledged
              const unanswered = inMemoryCalls.filter(
                (c) => c.teamId === teamId && c.status === 'unanswered',
              );
              if (unanswered.length > 0) {
                const idx = action.index % unanswered.length;
                unanswered[idx].status = 'acknowledged';
                unanswered[idx].refereeId = 'ref-1';
                unanswered[idx].refereeName = 'Referee 1';
                unanswered[idx].acknowledgedAt = new Date().toISOString();
              }
            }

            // INVARIANT CHECK: count of active calls must never exceed 2
            const activeCount = inMemoryCalls.filter(
              (c) =>
                c.teamId === teamId &&
                (c.status === 'unanswered' || c.status === 'acknowledged'),
            ).length;

            if (activeCount > 2) {
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
