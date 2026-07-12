// Feature: pool-referee-call-app, Property 8: Session Token Non-Reversibility

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { hashToken } from '@/lib/auth/tokens';

describe('Property 8: Session Token Non-Reversibility', () => {
  it('hashToken(t) !== t for all token strings', () => {
    fc.assert(
      fc.property(fc.string(), (token) => {
        return hashToken(token) !== token;
      }),
      { numRuns: 100 },
    );
  });
});
