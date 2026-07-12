// Feature: pool-referee-call-app, Property 6: Queue Position Contiguity Invariant

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { assignPositions, QueueEntry } from '@/lib/queue/position';

/**
 * **Validates: Requirements 16.1, 16.2, 16.3**
 *
 * For any referee queue containing N acknowledged calls, the set of position
 * values assigned by assignPositions SHALL equal exactly {1, 2, ..., N} —
 * no gaps, no duplicates, starting from 1.
 */
describe('Property 6: Queue Position Contiguity Invariant', () => {
  const queueEntryArb: fc.Arbitrary<QueueEntry> = fc.record({
    callId: fc.uuid(),
    teamId: fc.uuid(),
    teamName: fc.string({ minLength: 1, maxLength: 50 }),
    tableNumber: fc.integer({ min: 1, max: 999 }),
    acknowledgedAt: fc.date().map((d) => d.toISOString()),
  });

  it('assignPositions produces positions equal to {1, ..., N} for any queue of size N', () => {
    fc.assert(
      fc.property(
        fc.array(queueEntryArb, { minLength: 0, maxLength: 50 }),
        (queue) => {
          const positioned = assignPositions(queue);
          const N = queue.length;

          // Length must be preserved
          if (positioned.length !== N) return false;

          // Positions must form exactly {1, 2, ..., N}
          const positions = positioned.map((e) => e.position).sort((a, b) => a - b);
          for (let i = 0; i < N; i++) {
            if (positions[i] !== i + 1) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: pool-referee-call-app, Property 7: Queue Position After Removal — Metamorphic Property

/**
 * **Validates: Requirements 16.4, 10.2, 10.3**
 *
 * For any referee queue of N calls where the call at index K is removed,
 * the positions of all remaining N-1 calls SHALL form the contiguous
 * sequence {1, 2, ..., N-1} with every call that was previously at a
 * position > K decremented by exactly 1.
 */
describe('Property 7: Queue Position After Removal — Metamorphic Property', () => {
  const queueEntryArb: fc.Arbitrary<QueueEntry> = fc.record({
    callId: fc.uuid(),
    teamId: fc.uuid(),
    teamName: fc.string({ minLength: 1, maxLength: 50 }),
    tableNumber: fc.integer({ min: 1, max: 999 }),
    acknowledgedAt: fc.date().map((d) => d.toISOString()),
  });

  it('after removing entry at index K, remaining positions equal {1, ..., N-1} with higher positions decremented', () => {
    fc.assert(
      fc.property(
        fc.array(queueEntryArb, { minLength: 1, maxLength: 50 }).chain((queue) =>
          fc.nat({ max: queue.length - 1 }).map((k) => ({ queue, k }))
        ),
        ({ queue, k }) => {
          // Run assignPositions on the full queue to get original positions
          const originalPositioned = assignPositions(queue);
          const N = originalPositioned.length;

          // Identify the entry being removed (by its position in the sorted result)
          const removedEntry = originalPositioned[k];
          const removedPosition = removedEntry.position; // K+1 (1-indexed)

          // Remove the entry at index K from the original (unsorted) queue by callId
          const remainingQueue = queue.filter((e) => e.callId !== removedEntry.callId);

          // Run assignPositions on the remaining N-1 entries
          const remainingPositioned = assignPositions(remainingQueue);

          // Assert positions of remaining entries equal {1, ..., N-1}
          if (remainingPositioned.length !== N - 1) return false;

          const positions = remainingPositioned.map((e) => e.position).sort((a, b) => a - b);
          for (let i = 0; i < N - 1; i++) {
            if (positions[i] !== i + 1) return false;
          }

          // Assert entries that were previously at positions > removedPosition
          // have been decremented by exactly 1
          for (const entry of remainingPositioned) {
            const originalEntry = originalPositioned.find((o) => o.callId === entry.callId);
            if (!originalEntry) return false;

            if (originalEntry.position > removedPosition) {
              // Should be decremented by 1
              if (entry.position !== originalEntry.position - 1) return false;
            } else {
              // Should remain the same
              if (entry.position !== originalEntry.position) return false;
            }
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
