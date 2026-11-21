import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// Tooling smoke test: proves fast-check runs under Vitest. Real property tests
// (creature invariants, plan §5) arrive with the rules they check.
describe('fast-check', () => {
  it('runs properties', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(Math.imul(a, b)).toBe(Math.imul(b, a));
      }),
    );
  });
});
