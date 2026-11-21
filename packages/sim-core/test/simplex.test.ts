import { describe, expect, it } from 'vitest';
import { createRngStream } from '../src/rng.js';
import { createSimplex2D, fbm2D } from '../src/map/simplex.js';

describe('2D simplex noise & fbm2D', () => {
  it('produces identical values for the same seed and differs for different seeds', () => {
    const a = createSimplex2D(createRngStream('noise-1'));
    const b = createSimplex2D(createRngStream('noise-1'));
    const c = createSimplex2D(createRngStream('noise-2'));

    const samplesA: number[] = [];
    const samplesB: number[] = [];
    const samplesC: number[] = [];

    for (let y = -10; y <= 10; y += 2.5) {
      for (let x = -10; x <= 10; x += 2.5) {
        const va = a(x * 0.13, y * 0.13);
        const vb = b(x * 0.13, y * 0.13);
        const vc = c(x * 0.13, y * 0.13);
        expect(va).toBeGreaterThanOrEqual(-1.1);
        expect(va).toBeLessThanOrEqual(1.1);
        samplesA.push(va);
        samplesB.push(vb);
        samplesC.push(vc);
      }
    }

    expect(samplesA).toEqual(samplesB);
    expect(samplesA).not.toEqual(samplesC);
  });

  it('handles octaves = 0, octaves = 1 and multi-octave normalization in fbm2D', () => {
    const noise = createSimplex2D(createRngStream(777));
    expect(fbm2D(noise, 1.25, -3.5, 0, 2, 0.5)).toBe(0);
    expect(fbm2D(noise, 1.25, -3.5, 1, 2, 0.5)).toBe(noise(1.25, -3.5));

    for (let i = 0; i < 50; i++) {
      const val = fbm2D(noise, i * 0.37, -i * 0.21, 4, 2, 0.5);
      expect(val).toBeGreaterThanOrEqual(-1.1);
      expect(val).toBeLessThanOrEqual(1.1);
    }
  });
});
