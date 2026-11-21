import { describe, expect, it } from 'vitest';
import { SIM_VERSION } from '../src/index.js';

describe('SIM_VERSION', () => {
  it('is a non-negative integer', () => {
    expect(Number.isInteger(SIM_VERSION)).toBe(true);
    expect(SIM_VERSION).toBeGreaterThanOrEqual(0);
  });
});
