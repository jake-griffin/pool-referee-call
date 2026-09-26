/**
 * lib/calls/manager.ts
 *
 * Call_Manager — orchestrates call creation, acknowledgement, and completion.
 *
 * All functions accept and return plain typed objects (no HTTP concerns).
 * Route handlers translate domain errors to appropriate HTTP status codes.
 *
 * Requirements: 6.1–6.7, 7.1–7.6, 8.1–8.5, 13.2, 13.4, 17.1, 17.2
 */

import { generateToken } from '@/lib/auth/tokens';
import {
  getTournamentMeta,
  getCall,
  putCall,
  updateCallAcknowledge,
  updateCallComplete,
  updateCallCancel,
  queryUnansweredQueue,
  AlreadyClaimedError as DbAlreadyClaimedError,
} from '@/lib/db/queries';
import type { CallRecord } from '@/lib/db/queries';
import {
  TournamentClosedError,
  InvalidTableError,
  MaxCallsError,
  AlreadyClaimedError,
  CallNotFoundError,
  WrongRefereeError,
  WrongStatusError,
} from './errors';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateCallInput {
  tournamentId: string;
  teamId: string;
  teamName: string;
  tableNumber: number;
}

// Re-export CallRecord so consumers only import from manager
export type { CallRecord };

// ---------------------------------------------------------------------------
// createCall
// ---------------------------------------------------------------------------

/**
 * Creates a new referee call.
 *
 * Algorithm:
 *  1. Verify tournament is active.
 *  2. Verify tableNumber is in tournament.tableNumbers.
 *  3. Count team's active calls (unanswered + acknowledged). If >= 2, reject.
 *  4. Write CALL#{callId} with status=unanswered and GSI1 unanswered attributes.
 *  5. Return CallRecord.
 *
 * Throws: TournamentClosedError | InvalidTableError | MaxCallsError
 * Requirements: 6.1–6.7, 17.1, 17.2
 */
export async function createCall(input: CreateCallInput): Promise<CallRecord> {
  const { tournamentId, teamId, teamName, tableNumber } = input;

  // Step 1: verify tournament is active
  const tournament = await getTournamentMeta(tournamentId);
  if (!tournament) {
    throw new CallNotFoundError(tournamentId); // shouldn't normally happen
  }
  if (tournament.status === 'closed') {
    throw new TournamentClosedError();
  }

  // Step 2: verify table number is valid
  if (!tournament.tableNumbers.includes(tableNumber)) {
    throw new InvalidTableError(tableNumber);
  }

  // Step 3: count active calls for this team (unanswered + acknowledged)
  const activeCount = await countActiveCallsForTeam(tournamentId, teamId);
  if (activeCount >= 2) {
    throw new MaxCallsError();
  }

  // Step 4: create the call record
  const callId = `c_${generateToken().replace(/-/g, '')}`;
  const now = new Date().toISOString();

  const record: CallRecord = {
    callId,
    tournamentId,
    teamId,
    teamName,
    tableNumber,
    status: 'unanswered',
    refereeId: null,
    refereeName: null,
    createdAt: now,
    acknowledgedAt: null,
    completedAt: null,
    cancelledAt: null,
  };

  await putCall(record);
  return record;
}

// ---------------------------------------------------------------------------
// acknowledgeCall
// ---------------------------------------------------------------------------

/**
 * Atomically acknowledges a call.
 *
 * Algorithm:
 *  1. Verify tournament is active.
 *  2. Verify call exists and belongs to tournament.
 *  3. Execute TransactWriteItems (via db layer) with condition on status.
 *  4. Return updated CallRecord.
 *
 * Throws: TournamentClosedError | CallNotFoundError | AlreadyClaimedError
 * Requirements: 7.1–7.6
 */
export async function acknowledgeCall(
  callId: string,
  refereeId: string,
  refereeName: string,
  tournamentId: string,
): Promise<CallRecord> {
  // Step 1: verify tournament is active
  const tournament = await getTournamentMeta(tournamentId);
  if (!tournament) {
    throw new CallNotFoundError(callId);
  }
  if (tournament.status === 'closed') {
    throw new TournamentClosedError();
  }

  // Step 2: verify call exists
  const call = await getCall(tournamentId, callId);
  if (!call) {
    throw new CallNotFoundError(callId);
  }

  // Step 3: atomic acknowledge via TransactWriteItems
  const acknowledgedAt = new Date().toISOString();
  try {
    await updateCallAcknowledge(
      tournamentId,
      callId,
      refereeId,
      refereeName,
      acknowledgedAt,
    );
  } catch (err) {
    if (err instanceof DbAlreadyClaimedError) {
      throw new AlreadyClaimedError();
    }
    throw err;
  }

  // Step 4: return updated record
  return {
    ...call,
    status: 'acknowledged',
    refereeId,
    refereeName,
    acknowledgedAt,
  };
}

// ---------------------------------------------------------------------------
// completeCall
// ---------------------------------------------------------------------------

/**
 * Marks an acknowledged call as complete.
 *
 * Algorithm:
 *  1. Verify tournament is active.
 *  2. Verify call exists and referee ownership.
 *  3. UpdateItem with conditions on status + refereeId.
 *  4. Return updated CallRecord.
 *
 * Throws: TournamentClosedError | CallNotFoundError | WrongRefereeError | WrongStatusError
 * Requirements: 8.1–8.5
 */
export async function completeCall(
  callId: string,
  refereeId: string,
  tournamentId: string,
): Promise<CallRecord> {
  // Step 1: verify tournament is active
  const tournament = await getTournamentMeta(tournamentId);
  if (!tournament) {
    throw new CallNotFoundError(callId);
  }
  if (tournament.status === 'closed') {
    throw new TournamentClosedError();
  }

  // Step 2: verify call exists and ownership
  const call = await getCall(tournamentId, callId);
  if (!call) {
    throw new CallNotFoundError(callId);
  }
  if (call.status !== 'acknowledged') {
    throw new WrongStatusError('acknowledged', call.status);
  }
  if (call.refereeId !== refereeId) {
    throw new WrongRefereeError();
  }

  // Step 3: update
  const completedAt = new Date().toISOString();
  await updateCallComplete(tournamentId, callId, refereeId, completedAt);

  // Step 4: return updated record
  return {
    ...call,
    status: 'completed',
    completedAt,
  };
}

// ---------------------------------------------------------------------------
// completeCallAsAdmin — complete on behalf of the assigned referee
// ---------------------------------------------------------------------------

/**
 * Admin/director variant of completeCall: marks an acknowledged call complete
 * without the referee-ownership check (the admin is acting on the referee's
 * behalf). Still requires the call to be in 'acknowledged' status.
 *
 * Throws: TournamentClosedError | CallNotFoundError | WrongStatusError
 */
export async function completeCallAsAdmin(
  callId: string,
  tournamentId: string,
): Promise<CallRecord> {
  const tournament = await getTournamentMeta(tournamentId);
  if (!tournament) throw new CallNotFoundError(callId);
  if (tournament.status === 'closed') throw new TournamentClosedError();

  const call = await getCall(tournamentId, callId);
  if (!call) throw new CallNotFoundError(callId);
  if (call.status !== 'acknowledged') {
    throw new WrongStatusError('acknowledged', call.status);
  }
  if (!call.refereeId) throw new WrongStatusError('acknowledged', call.status);

  const completedAt = new Date().toISOString();
  // Complete using the call's own assigned referee (ownership check passes).
  await updateCallComplete(tournamentId, callId, call.refereeId, completedAt);

  return { ...call, status: 'completed', completedAt };
}

// ---------------------------------------------------------------------------
// cancelCall
// ---------------------------------------------------------------------------

/**
 * Cancels a call. Valid from 'unanswered' or 'acknowledged'; sets status to
 * 'cancelled'. When expectedTeamId is provided (player cancelling their own
 * call), the call must belong to that team, otherwise WrongStatusError-style
 * ownership is enforced via WrongRefereeError semantics using a team check.
 *
 * Throws: TournamentClosedError | CallNotFoundError | WrongStatusError |
 *         CallOwnershipError (when expectedTeamId doesn't match)
 */
export async function cancelCall(
  callId: string,
  tournamentId: string,
  opts?: { expectedTeamId?: string },
): Promise<CallRecord> {
  const tournament = await getTournamentMeta(tournamentId);
  if (!tournament) throw new CallNotFoundError(callId);
  if (tournament.status === 'closed') throw new TournamentClosedError();

  const call = await getCall(tournamentId, callId);
  if (!call) throw new CallNotFoundError(callId);

  // Ownership: a player may only cancel their own team's call.
  if (opts?.expectedTeamId && call.teamId !== opts.expectedTeamId) {
    throw new WrongRefereeError(); // reused as a generic "not yours" 403
  }

  if (call.status !== 'unanswered' && call.status !== 'acknowledged') {
    throw new WrongStatusError('unanswered or acknowledged', call.status);
  }

  const cancelledAt = new Date().toISOString();
  await updateCallCancel(tournamentId, callId, cancelledAt);

  return { ...call, status: 'cancelled', cancelledAt };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Counts a team's active calls across both the unanswered queue and all
 * referee queues. This is done by querying the base table and filtering,
 * which is efficient for the typical case (< 10 calls per team).
 */
async function countActiveCallsForTeam(
  tournamentId: string,
  teamId: string,
): Promise<number> {
  // Query unanswered queue and check for this team's calls
  const unanswered = await queryUnansweredQueue(tournamentId);
  const unansweredCount = unanswered.filter((c) => c.teamId === teamId).length;

  // For acknowledged calls we need to check referee queues.
  // Efficient approach: scan base table calls or use queryAllTournamentItems,
  // but the simplest correct approach is to use the full base-table query.
  // Since this is bounded by a single tournament, it's fast.
  //
  // Alternative: we already have unanswered calls above. For acknowledged,
  // we import queryAllTournamentItems but that's heavier. Instead, let's
  // query all CALL# items for this team by querying the base table.
  // DynamoDB doesn't support a begins_with on SK combined with a filter
  // in a single efficient query without scanning. But given the scale
  // (~hundreds of calls max), filtering from the full result is acceptable.
  //
  // For now, use a pragmatic approach: import queryAllTournamentItems from
  // the DB layer and count from the in-memory result.
  const { queryAllTournamentItems } = await import('@/lib/db/queries');
  const allItems = await queryAllTournamentItems(tournamentId);
  const acknowledgedCount = allItems.calls.filter(
    (c) => c.teamId === teamId && c.status === 'acknowledged',
  ).length;

  return unansweredCount + acknowledgedCount;
}
