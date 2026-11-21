import { describe, expect, it } from 'vitest';
import {
  brainSpecFromConfig,
  createRngStream,
  crossoverPerNeuron,
  DEFAULT_CONFIG,
  gaussian,
  inputWeightIndex,
  mutateGenome,
  outputBiasIndex,
  outputWeightIndex,
  randomGenome,
  weightCount,
} from '../src/index.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);

describe('randomGenome', () => {
  it('draws every weight uniformly in [-range, range), reproducibly', () => {
    const a = randomGenome(SPEC, createRngStream('g'), 2);
    const b = randomGenome(SPEC, createRngStream('g'), 2);
    expect(a).toHaveLength(weightCount(SPEC));
    expect(a).toEqual(b);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-2);
    expect(Math.max(...a)).toBeLessThan(2);
    expect(Math.min(...a)).toBeLessThan(-1.5);
    expect(Math.max(...a)).toBeGreaterThan(1.5);
    expect(randomGenome(SPEC, createRngStream('g'), 0).every((w) => w === 0)).toBe(true);
  });
});

describe('gaussian', () => {
  it('has mean ≈ 0 and variance ≈ 1, bounded to ±6', () => {
    const rng = createRngStream('normal');
    const n = 20_000;
    let sum = 0;
    let sumSq = 0;
    let maxAbs = 0;
    for (let i = 0; i < n; i++) {
      const x = gaussian(rng);
      sum += x;
      sumSq += x * x;
      maxAbs = Math.max(maxAbs, Math.abs(x));
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(sumSq / n - mean * mean).toBeGreaterThan(0.95);
    expect(sumSq / n - mean * mean).toBeLessThan(1.05);
    expect(maxAbs).toBeLessThanOrEqual(6);
  });
});

describe('crossoverPerNeuron', () => {
  const a = new Float32Array(weightCount(SPEC)).fill(1);
  const b = new Float32Array(weightCount(SPEC)).fill(2);

  it("takes each hidden neuron's incoming and outgoing weights from one parent", () => {
    const rng = createRngStream('cross');
    const seenParents = new Set<number>();
    for (let trial = 0; trial < 20; trial++) {
      const child = crossoverPerNeuron(SPEC, a, b, rng);
      for (let h = 0; h < SPEC.hidden; h++) {
        const parent = child[inputWeightIndex(SPEC, h, 0)]!;
        seenParents.add(parent);
        for (let i = 0; i < SPEC.inputs; i++) {
          expect(child[inputWeightIndex(SPEC, h, i)]).toBe(parent);
        }
        for (let o = 0; o < SPEC.outputs; o++) {
          expect(child[outputWeightIndex(SPEC, h, o)]).toBe(parent);
        }
      }
      const biasParent = child[outputBiasIndex(SPEC, 0)]!;
      for (let o = 0; o < SPEC.outputs; o++) {
        expect(child[outputBiasIndex(SPEC, o)]).toBe(biasParent);
      }
    }
    expect([...seenParents].sort()).toEqual([1, 2]);
  });

  it('is reproducible and leaves the parents untouched', () => {
    const x = crossoverPerNeuron(SPEC, a, b, createRngStream('same'));
    const y = crossoverPerNeuron(SPEC, a, b, createRngStream('same'));
    expect(x).toEqual(y);
    expect(a.every((w) => w === 1)).toBe(true);
    expect(b.every((w) => w === 2)).toBe(true);
  });
});

describe('mutateGenome', () => {
  it('changes nothing at rate 0, but still draws one coin per weight', () => {
    const genome = randomGenome(SPEC, createRngStream('m'), 2);
    const before = Float32Array.from(genome);
    const rng = createRngStream('coins');
    const reference = createRngStream('coins');
    mutateGenome(genome, rng, { rate: 0, sigma: 0.2, clamp: 4 });
    expect(genome).toEqual(before);
    for (let i = 0; i < genome.length; i++) reference.nextFloat();
    expect(rng.getState()).toEqual(reference.getState());
  });

  it('adds noise to about `rate` of the weights', () => {
    const genome = new Float32Array(10_000);
    mutateGenome(genome, createRngStream('rate'), { rate: 0.05, sigma: 0.2, clamp: 4 });
    const changed = genome.filter((w) => w !== 0).length;
    expect(changed).toBeGreaterThan(400);
    expect(changed).toBeLessThan(600);
  });

  it('clamps every weight to ±clamp', () => {
    const genome = new Float32Array(1000).fill(3.9);
    genome.fill(-3.9, 500);
    mutateGenome(genome, createRngStream('clamp'), { rate: 1, sigma: 5, clamp: 4 });
    expect(Math.max(...genome)).toBeLessThanOrEqual(4);
    expect(Math.min(...genome)).toBeGreaterThanOrEqual(-4);
    expect(genome.filter((w) => w === 4 || w === -4).length).toBeGreaterThan(100);
  });
});
