// Feature: pool-referee-call-app, Property 1: Table Range Parser — Round-Trip
// Feature: pool-referee-call-app, Property 2: Table Range Parser — Sorted Unique Output Invariant
// Feature: pool-referee-call-app, Property 3: Table Range Parser — Inverted Range Rejection

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { parseTableRange, formatTableRange } from '@/lib/tables/range-parser';

describe('Property 1: Table Range Parser — Round-Trip', () => {
  it('parseTableRange(formatTableRange(L)).tables deep-equals L for all valid sorted unique positive integer lists', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 1 }).map((arr) => {
          // Deduplicate and sort ascending
          const unique = [...new Set(arr)].sort((a, b) => a - b);
          return unique;
        }),
        (L) => {
          const formatted = formatTableRange(L);
          const result = parseTableRange(formatted);
          if (!result.ok) return false;
          return (
            result.tables.length === L.length &&
            result.tables.every((val, idx) => val === L[idx])
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: Table Range Parser — Sorted Unique Output Invariant', () => {
  it('every element in parseTableRange(S).tables is strictly greater than the previous', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 1 }).map((arr) => {
          // Build a valid range string from known-good integer lists
          const unique = [...new Set(arr)].sort((a, b) => a - b);
          return formatTableRange(unique);
        }),
        (rangeString) => {
          const result = parseTableRange(rangeString);
          if (!result.ok) return false;
          for (let i = 1; i < result.tables.length; i++) {
            if (result.tables[i] <= result.tables[i - 1]) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 3: Table Range Parser — Inverted Range Rejection', () => {
  it('parseTableRange("a-b") returns { ok: false } for all pairs where a > b', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 999 }),
        fc.integer({ min: 1, max: 998 }),
        (a, bRaw) => {
          // Ensure a > b
          const b = bRaw < a ? bRaw : undefined;
          if (b === undefined) return true; // skip if we can't make a > b
          const result = parseTableRange(`${a}-${b}`);
          return result.ok === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('parseTableRange("a-b") always rejects when a > b (constrained generation)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 999 }).chain((a) =>
          fc.integer({ min: 1, max: a - 1 }).map((b) => [a, b] as const),
        ),
        ([a, b]) => {
          const result = parseTableRange(`${a}-${b}`);
          return result.ok === false;
        },
      ),
      { numRuns: 100 },
    );
  });
});
