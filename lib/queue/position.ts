/**
 * lib/queue/position.ts
 *
 * Queue_Position_Calculator — assigns contiguous 1-indexed positions
 * to calls in a referee's active queue.
 *
 * Properties guaranteed:
 *  - Positions form exactly {1, ..., N} (Property 6: contiguity invariant)
 *  - After removal at position K, re-running assignPositions on N-1 entries
 *    yields {1, ..., N-1} (Property 7: metamorphic removal property)
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 10.2, 10.3
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueEntry {
  callId:         string;
  teamId:         string;
  teamName:       string;
  tableNumber:    number;
  acknowledgedAt: string;
}

export interface PositionedQueueEntry extends QueueEntry {
  position: number; // 1-indexed, contiguous, no gaps
}

// ---------------------------------------------------------------------------
// assignPositions
// ---------------------------------------------------------------------------

/**
 * Assigns contiguous 1-indexed positions to a referee queue.
 *
 * Algorithm:
 *  1. Defensive sort by acknowledgedAt ascending (DynamoDB GSI1SK already
 *     returns them in this order, but we sort to guarantee correctness).
 *  2. Map each entry to { ...entry, position: index + 1 }.
 *  3. Return the positioned array.
 *
 * Requirements: 16.1, 16.2, 16.3
 */
export function assignPositions(queue: QueueEntry[]): PositionedQueueEntry[] {
  const sorted = [...queue].sort((a, b) =>
    a.acknowledgedAt.localeCompare(b.acknowledgedAt),
  );
  return sorted.map((entry, index) => ({ ...entry, position: index + 1 }));
}

// ---------------------------------------------------------------------------
// getTeamPosition
// ---------------------------------------------------------------------------

/**
 * Finds the position of a specific team's call in a positioned referee queue.
 * Returns null if the team has no call in this referee's queue.
 *
 * Requirements: 10.2, 10.3
 */
export function getTeamPosition(
  queue: PositionedQueueEntry[],
  teamId: string,
): number | null {
  const entry = queue.find((e) => e.teamId === teamId);
  return entry?.position ?? null;
}
