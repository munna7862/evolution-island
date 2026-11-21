import { describe, expect, it } from 'vitest';
import { computeInterpolationAlpha, lerp } from '../src/renderer/interpolation.js';

describe('interpolation helpers', () => {
  it('computes clamped interpolation alpha cleanly', () => {
    expect(computeInterpolationAlpha(0, 100, true)).toBe(0);
    expect(computeInterpolationAlpha(25, 100, true)).toBe(0.25);
    expect(computeInterpolationAlpha(100, 100, true)).toBe(1);
    expect(computeInterpolationAlpha(250, 100, true)).toBe(1);
    expect(computeInterpolationAlpha(-10, 100, true)).toBe(0);

    // Paused, non-positive tickDurationMs, or non-finite elapsed snaps cleanly to 1.
    expect(computeInterpolationAlpha(25, 100, false)).toBe(1);
    expect(computeInterpolationAlpha(25, 0, true)).toBe(1);
    expect(computeInterpolationAlpha(25, -5, true)).toBe(1);
    expect(computeInterpolationAlpha(Number.NaN, 100, true)).toBe(1);
  });

  it('interpolates coordinates linearly', () => {
    expect(lerp(10, 11, 0)).toBe(10);
    expect(lerp(10, 11, 0.5)).toBe(10.5);
    expect(lerp(10, 11, 1)).toBe(11);
    expect(lerp(10, 9, 0.25)).toBe(9.75);
  });
});
