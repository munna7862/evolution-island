import type { RngStream } from '../rng.js';

/**
 * Pure, engine-independent 2D Simplex Noise (Gustavson's algorithm).
 * Uses only +, -, *, /, Math.floor and Math.sqrt (plan §3.3).
 */
export type Noise2D = (x: number, y: number) => number;

const SQRT3 = Math.sqrt(3);
const F2 = 0.5 * (SQRT3 - 1);
const G2 = (3 - SQRT3) / 6;

const GRAD2_X: readonly number[] = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD2_Y: readonly number[] = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];

export function createSimplex2D(rng: RngStream): Noise2D {
  const base = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    base[i] = i;
  }
  rng.shuffle(base);

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    const val = base[i & 255]!;
    perm[i] = val;
    permMod12[i] = val % 12;
  }

  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    let i1 = 0;
    let j1 = 1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj]!]!;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD2_X[gi0]! * x0 + GRAD2_Y[gi0]! * y0);
    }

    let n1 = 0;
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1]!]!;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD2_X[gi1]! * x1 + GRAD2_Y[gi1]! * y1);
    }

    let n2 = 0;
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + 1 + perm[jj + 1]!]!;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD2_X[gi2]! * x2 + GRAD2_Y[gi2]! * y2);
    }

    // Scale to approximately [-1, 1].
    return 70 * (n0 + n1 + n2);
  };
}

/**
 * Multi-octave fractal Brownian motion normalized to [-1, 1].
 */
export function fbm2D(
  noise: Noise2D,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    maxAmplitude += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return maxAmplitude > 0 ? sum / maxAmplitude : 0;
}
