// Feature: pool-referee-call-app, Property 9: Closed Tournament Mutation Rejection

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { TournamentClosedError } from '@/lib/calls/errors';
import type { CallRecord, TournamentRecord, AllTournamentItems } from '@/lib/db/queries';

// ---------------------------------------------------------------------------
// Mock @/lib/auth/tokens to avoid crypto dependency issues in test env
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth/tokens', () => ({
  generateToken: () => `mock-token`,
  hashToken: (t: string) => `sha256:${t}`,
  verifyToken: () => true,
}));

// ---------------------------------------------------------------------------
// Mock DynamoDB queries — tournament always returns closed status
// ---------------------------------------------------------------------------

let mockTableNumbers: number[] = [];

vi.mock('@/lib/db/queries', () => {
  class MockAlreadyClaimedError extends Error {
    readonly code = 'ALREADY_CLAIMED' as const;
    constructor() {
      super('This call was already claimed by another referee.');
      this.name = 'AlreadyClaimedError';
    }
  }

  return {
    getTournamentMeta: vi.fn(async (tournamentId: string): Promise<TournamentRecord> => ({
      tournamentId,
      name: 'Closed Tournament',
      status: 'closed',
      tableNumbers: mockTableNumbers,
      adminTokenHash: 'sha256:admin',
      refereeTokenHash: 'sha256:referee',
      playerTokenHash: 'sha256:player',
      createdAt: '2025-01-01T00:00:00.000Z',
    })),
    getCall: vi.fn(async (_tid: string, callId: string): Promise<CallRecord> => ({
      callId,
      tournamentId: _tid,
      teamId: 'team-1',
      teamName: 'Some Team',
      tableNumber: 1,
      status: 'acknowledged',
      refereeId: 'ref-existing',
      refereeName: 'Existing Referee',
      createdAt: '2025-01-01T10:00:00.000Z',
      acknowledgedAt: '2025-01-01T10:01:00.000Z',
      completedAt: null,
      cancelledAt: null,
    })),
    putCall: vi.fn(),
    updateCallAcknowledge: vi.fn(),
    updateCallComplete: vi.fn(),
    queryUnansweredQueue: vi.fn(async () => []),
    queryRefereeQueue: vi.fn(async () => []),
    queryAllTournamentItems: vi.fn(async (tournamentId: string): Promise<AllTournamentItems> => ({
      tournament: {
        tournamentId,
        name: 'Closed Tournament',
        status: 'closed',
        tableNumbers: mockTableNumbers,
        adminTokenHash: 'sha256:admin',
        refereeTokenHash: 'sha256:referee',
        playerTokenHash: 'sha256:player',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      calls: [],
      referees: [],
      teams: [],
      sessions: [],
    })),
    AlreadyClaimedError: MockAlreadyClaimedError,
  };
});

// Import domain functions AFTER mocks are set up
import { createCall, acknowledgeCall, completeCall } from '@/lib/calls/manager';

/**
 * **Validates: Requirements 13.2, 13.3, 13.4**
 *
 * For any tournament with `status = "closed"`, for every mutating operation
 * (create call, acknowledge call, complete call), the domain layer SHALL throw
 * a TournamentClosedError, regardless of whether the inputs are otherwise valid.
 *
 * NOTE: Join route rejection (Requirement 13.3) is handled directly in the
 * route handlers (checking `tournament.status === 'closed'`) and is covered
 * by unit tests in task 9.8.
 */
describe('Property 9: Closed Tournament Mutation Rejection', () => {
  beforeEach(() => {
    mockTableNumbers = [];
  });

  it('all Call_Manager mutating operations throw TournamentClosedError when tournament is closed', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pick a random mutating operation
        fc.constantFrom('createCall', 'acknowledgeCall', 'completeCall'),
        // Generate random inputs
        fc.uuid(),                              // tournamentId
        fc.uuid(),                              // teamId
        fc.string({ minLength: 1, maxLength: 50 }), // teamName
        fc.integer({ min: 1, max: 999 }),       // tableNumber
        fc.uuid(),                              // callId
        fc.uuid(),                              // refereeId
        fc.string({ minLength: 1, maxLength: 50 }), // refereeName
        async (operation, tournamentId, teamId, teamName, tableNumber, callId, refereeId, refereeName) => {
          // Ensure the table is included in the tournament's tableNumbers
          // so the only rejection reason is the closed status
          mockTableNumbers = [tableNumber];

          let threw = false;
          let thrownError: unknown;

          try {
            switch (operation) {
              case 'createCall':
                await createCall({
                  tournamentId,
                  teamId,
                  teamName,
                  tableNumber,
                });
                break;

              case 'acknowledgeCall':
                await acknowledgeCall(callId, refereeId, refereeName, tournamentId);
                break;

              case 'completeCall':
                await completeCall(callId, refereeId, tournamentId);
                break;
            }
          } catch (err) {
            threw = true;
            thrownError = err;
          }

          // PROPERTY: The operation MUST throw
          expect(threw).toBe(true);
          // PROPERTY: The thrown error MUST be TournamentClosedError
          expect(thrownError).toBeInstanceOf(TournamentClosedError);
        },
      ),
      { numRuns: 100 },
    );
  });
});
