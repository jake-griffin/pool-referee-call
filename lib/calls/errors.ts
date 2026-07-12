/**
 * lib/calls/errors.ts
 *
 * Typed error classes for the Call_Manager domain layer.
 * Each error carries a discriminant `code` field that route handlers
 * use to map to the appropriate HTTP status code.
 *
 * Requirements: 6.7, 7.5, 7.6, 8.3, 8.4, 13.2, 13.4
 */

export class TournamentClosedError extends Error {
  readonly code = 'TOURNAMENT_CLOSED' as const;
  constructor() {
    super('This tournament is closed.');
    this.name = 'TournamentClosedError';
  }
}

export class InvalidTableError extends Error {
  readonly code = 'INVALID_TABLE' as const;
  constructor(tableNumber: number) {
    super(`Table ${tableNumber} is not a valid table for this tournament.`);
    this.name = 'InvalidTableError';
  }
}

export class MaxCallsError extends Error {
  readonly code = 'MAX_CALLS' as const;
  constructor() {
    super('You already have 2 active calls. Wait for one to be completed.');
    this.name = 'MaxCallsError';
  }
}

export class AlreadyClaimedError extends Error {
  readonly code = 'ALREADY_CLAIMED' as const;
  constructor() {
    super('This call was already claimed by another referee.');
    this.name = 'AlreadyClaimedError';
  }
}

export class CallNotFoundError extends Error {
  readonly code = 'CALL_NOT_FOUND' as const;
  constructor(callId: string) {
    super(`Call ${callId} not found.`);
    this.name = 'CallNotFoundError';
  }
}

export class WrongRefereeError extends Error {
  readonly code = 'WRONG_REFEREE' as const;
  constructor() {
    super("You didn't acknowledge this call.");
    this.name = 'WrongRefereeError';
  }
}

export class WrongStatusError extends Error {
  readonly code = 'WRONG_STATUS' as const;
  constructor(expected: string, actual: string) {
    super(`Call is in '${actual}' status, expected '${expected}'.`);
    this.name = 'WrongStatusError';
  }
}
