import { describe, it, expect } from 'vitest';
import { parseTableRange, formatTableRange } from '@/lib/tables/range-parser';

describe('Table_Range_Parser — Unit Tests (Error Cases)', () => {
  it('returns error for empty string', () => {
    const result = parseTableRange('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it('returns error for whitespace-only string', () => {
    const result = parseTableRange('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it('returns error for non-integer characters', () => {
    const result = parseTableRange('1a-18');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/non-integer/i);
    }
  });

  it('returns error for inverted range "18-11"', () => {
    const result = parseTableRange('18-11');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/lower bound greater than upper bound/i);
    }
  });

  it('parses "11-11" as single element [11]', () => {
    const result = parseTableRange('11-11');
    expect(result).toEqual({ ok: true, tables: [11] });
  });

  it('parses "11-18, 11-13" with deduplication', () => {
    const result = parseTableRange('11-18, 11-13');
    expect(result).toEqual({
      ok: true,
      tables: [11, 12, 13, 14, 15, 16, 17, 18],
    });
  });

  it('parses a single number "29"', () => {
    const result = parseTableRange('29');
    expect(result).toEqual({ ok: true, tables: [29] });
  });

  it('parses multiple segments "1, 3, 5-7"', () => {
    const result = parseTableRange('1, 3, 5-7');
    expect(result).toEqual({ ok: true, tables: [1, 3, 5, 6, 7] });
  });

  it('handles duplicate individual numbers "5, 5, 5"', () => {
    const result = parseTableRange('5, 5, 5');
    expect(result).toEqual({ ok: true, tables: [5] });
  });

  it('returns error for trailing comma "11-13,"', () => {
    const result = parseTableRange('11-13,');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty segment/i);
    }
  });
});

describe('formatTableRange', () => {
  it('formats consecutive numbers as ranges', () => {
    expect(formatTableRange([11, 12, 13, 29, 30])).toBe('11-13, 29-30');
  });

  it('formats single number', () => {
    expect(formatTableRange([14])).toBe('14');
  });

  it('formats non-consecutive numbers individually', () => {
    expect(formatTableRange([11, 13, 15])).toBe('11, 13, 15');
  });

  it('formats empty array as empty string', () => {
    expect(formatTableRange([])).toBe('');
  });

  it('formats a mix of single numbers and ranges', () => {
    expect(formatTableRange([1, 2, 3, 7, 10, 11, 12])).toBe('1-3, 7, 10-12');
  });
});
