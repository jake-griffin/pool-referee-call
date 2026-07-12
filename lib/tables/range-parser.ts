/**
 * lib/tables/range-parser.ts
 *
 * Table_Range_Parser — parses compact table range strings into sorted,
 * deduplicated lists of integer table numbers.
 *
 * Format examples:
 *   "11-18"         → [11, 12, 13, 14, 15, 16, 17, 18]
 *   "29-36"         → [29, 30, 31, 32, 33, 34, 35, 36]
 *   "11-18, 29-36"  → [11..18, 29..36]
 *   "14"            → [14]
 *   "11-11"         → [11]   (equal bounds are valid single-number ranges)
 *
 * Requirements: 3.1–3.9, 2.5, 2.6
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParseSuccess = { ok: true; tables: number[] };
export type ParseError   = { ok: false; error: string };
export type ParseResult  = ParseSuccess | ParseError;

// ---------------------------------------------------------------------------
// parseTableRange
// ---------------------------------------------------------------------------

/**
 * Parses a compact table range string into a sorted, deduplicated list of
 * table numbers.
 *
 * Algorithm:
 *  1. Reject empty / whitespace-only input immediately (Requirement 3.7).
 *  2. Split on commas, trim each segment.
 *  3. For each segment:
 *     a. If it matches /^\d+$/ → single number (Requirement 3.2).
 *     b. If it matches /^(\d+)-(\d+)$/ → range; reject if lo > hi (Req 3.6).
 *     c. Otherwise → validation error: non-integer characters (Req 3.8).
 *  4. Collect all numbers into a Set (deduplication, Requirement 3.4).
 *  5. Sort ascending (Requirement 3.5).
 *  6. Return { ok: true, tables }.
 */
export function parseTableRange(input: string): ParseResult {
  // Step 1: reject empty / whitespace-only
  if (!input || !input.trim()) {
    return { ok: false, error: 'Table range must not be empty.' };
  }

  const collected = new Set<number>();

  const segments = input.split(',');
  for (const raw of segments) {
    const segment = raw.trim();

    if (segment === '') {
      // Trailing/leading comma — treat as empty segment error
      return {
        ok: false,
        error: `Table range contains an empty segment. Check for extra commas.`,
      };
    }

    // Case a: single integer
    if (/^\d+$/.test(segment)) {
      collected.add(parseInt(segment, 10));
      continue;
    }

    // Case b: lo-hi range
    const rangeMatch = /^(\d+)-(\d+)$/.exec(segment);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo > hi) {
        return {
          ok: false,
          error: `Range segment '${segment}' has lower bound greater than upper bound (${lo} > ${hi}).`,
        };
      }
      for (let n = lo; n <= hi; n++) {
        collected.add(n);
      }
      continue;
    }

    // Case c: non-integer characters
    return {
      ok: false,
      error: `Segment '${segment}' contains non-integer characters.`,
    };
  }

  if (collected.size === 0) {
    return { ok: false, error: 'Table range produced no valid table numbers.' };
  }

  const tables = Array.from(collected).sort((a, b) => a - b);
  return { ok: true, tables };
}

// ---------------------------------------------------------------------------
// formatTableRange
// ---------------------------------------------------------------------------

/**
 * Formats a sorted list of integers back to a canonical, human-readable range
 * string. Consecutive integers are collapsed into "lo-hi" segments.
 *
 * Examples:
 *   [11, 12, 13, 29, 30] → "11-13, 29-30"
 *   [14]                 → "14"
 *   [11, 13, 15]         → "11, 13, 15"
 *
 * Used by the admin UI live preview and round-trip property tests.
 */
export function formatTableRange(tables: number[]): string {
  if (tables.length === 0) return '';

  const segments: string[] = [];
  let rangeStart = tables[0];
  let rangeEnd = tables[0];

  for (let i = 1; i < tables.length; i++) {
    if (tables[i] === rangeEnd + 1) {
      // Extend the current run
      rangeEnd = tables[i];
    } else {
      // Flush the current run
      segments.push(formatSegment(rangeStart, rangeEnd));
      rangeStart = tables[i];
      rangeEnd = tables[i];
    }
  }
  // Flush the final run
  segments.push(formatSegment(rangeStart, rangeEnd));

  return segments.join(', ');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function formatSegment(lo: number, hi: number): string {
  return lo === hi ? `${lo}` : `${lo}-${hi}`;
}
