import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Action,
  ACTION_COUNT,
  argmaxAction,
  BRAIN_FORMAT_VERSION,
  brainSpecFromConfig,
  createBrainPolicy,
  createBrainScratch,
  createWorld,
  createZeroGenome,
  DEFAULT_CONFIG,
  forwardPass,
  inputWeightIndex,
  isWaterReachable,
  outputBiasIndex,
  outputWeightIndex,
  sameBrainSpec,
  SENSOR_COUNT,
  SensorIndex,
  softsign,
  validateBrainSpec,
  validateGenome,
  weightCount,
  type BrainSpec,
} from '../src/index.js';

/** The default brain: memory on since Sprint 3.5. */
const V1 = brainSpecFromConfig(DEFAULT_CONFIG);
const NO_MEMORY = brainSpecFromConfig({
  ...DEFAULT_CONFIG,
  brain: { ...DEFAULT_CONFIG.brain, memoryNeurons: 0 },
});
const TINY: BrainSpec = { formatVersion: BRAIN_FORMAT_VERSION, inputs: 2, hidden: 2, outputs: 3 };

/** Independent reference: plain nested sums over the index helpers, same summation order. */
function referenceForward(spec: BrainSpec, weights: Float32Array, inputs: Float32Array): number[] {
  const hidden: number[] = [];
  for (let h = 0; h < spec.hidden; h++) {
    let sum = 0;
    for (let i = 0; i < spec.inputs; i++) {
      sum += weights[inputWeightIndex(spec, h, i)]! * inputs[i]!;
    }
    hidden.push(softsign(sum));
  }
  const outputs: number[] = [];
  for (let o = 0; o < spec.outputs; o++) {
    let sum = 0;
    for (let h = 0; h < spec.hidden; h++) {
      sum += hidden[h]! * weights[outputWeightIndex(spec, h, o)]!;
    }
    outputs.push(sum + weights[outputBiasIndex(spec, o)]!);
  }
  return outputs;
}

describe('brain spec and genome layout', () => {
  it('derives the plan §2.4 sizes from config: 20 → 12 → 11 = 383 weights (18 → 12 → 9 = 333 without memory)', () => {
    expect(V1).toEqual({
      formatVersion: BRAIN_FORMAT_VERSION,
      inputs: SENSOR_COUNT + 2,
      hidden: 12,
      outputs: ACTION_COUNT + 2,
    });
    expect(weightCount(V1)).toBe(383);
    expect(NO_MEMORY).toEqual({
      formatVersion: BRAIN_FORMAT_VERSION,
      inputs: SENSOR_COUNT,
      hidden: 12,
      outputs: ACTION_COUNT,
    });
    expect(weightCount(NO_MEMORY)).toBe(333);
    // With memory + signals on (plan §2.4): 23 → 12 → 12 = 432.
    expect(weightCount({ ...V1, inputs: 23, outputs: 12 })).toBe(432);
  });

  it('places every weight exactly once (index helpers form a permutation)', () => {
    const seen = new Uint8Array(weightCount(V1));
    for (let h = 0; h < V1.hidden; h++) {
      for (let i = 0; i < V1.inputs; i++) seen[inputWeightIndex(V1, h, i)]!++;
      for (let o = 0; o < V1.outputs; o++) seen[outputWeightIndex(V1, h, o)]!++;
    }
    for (let o = 0; o < V1.outputs; o++) seen[outputBiasIndex(V1, o)]!++;
    expect(Array.from(seen).every((count) => count === 1)).toBe(true);
  });

  it("keeps each hidden neuron's weights in two contiguous slices", () => {
    const h = 5;
    const inStart = inputWeightIndex(V1, h, 0);
    const outStart = outputWeightIndex(V1, h, 0);
    for (let i = 0; i < V1.inputs; i++) expect(inputWeightIndex(V1, h, i)).toBe(inStart + i);
    for (let o = 0; o < V1.outputs; o++) expect(outputWeightIndex(V1, h, o)).toBe(outStart + o);
  });

  it('validates specs and genomes', () => {
    expect(() => {
      validateBrainSpec(V1);
    }).not.toThrow();
    expect(() => {
      validateBrainSpec({ ...V1, formatVersion: 2 });
    }).toThrow(RangeError);
    expect(() => {
      validateBrainSpec({ ...V1, hidden: 0 });
    }).toThrow(RangeError);
    expect(() => {
      validateBrainSpec({ ...V1, inputs: 1.5 });
    }).toThrow(RangeError);
    expect(sameBrainSpec(V1, { ...V1 })).toBe(true);
    expect(sameBrainSpec(V1, { ...V1, hidden: 13 })).toBe(false);

    const genome = createZeroGenome(V1);
    expect(genome).toHaveLength(383);
    expect(() => {
      validateGenome(V1, genome);
    }).not.toThrow();
    expect(() => {
      validateGenome(V1, new Float32Array(382));
    }).toThrow(RangeError);
    genome[100] = Number.NaN;
    expect(() => {
      validateGenome(V1, genome);
    }).toThrow(RangeError);
    genome[100] = Number.POSITIVE_INFINITY;
    expect(() => {
      validateGenome(V1, genome);
    }).toThrow(RangeError);
  });
});

describe('forward pass', () => {
  it('softsign squashes into (-1, 1) with exact simple values', () => {
    expect(softsign(0)).toBe(0);
    expect(softsign(1)).toBe(0.5);
    expect(softsign(-3)).toBe(-0.75);
    expect(softsign(1e9)).toBeLessThan(1);
    expect(softsign(-1e9)).toBeGreaterThan(-1);
  });

  it('matches a hand-computed 2 → 2 → 3 network exactly', () => {
    const w = new Float32Array(weightCount(TINY));
    expect(w).toHaveLength(2 * 2 + 3 * 3);
    // Hidden 0: 1·x0 + 2·x1; hidden 1: -1·x0 + 0·x1.
    w[inputWeightIndex(TINY, 0, 0)] = 1;
    w[inputWeightIndex(TINY, 0, 1)] = 2;
    w[inputWeightIndex(TINY, 1, 0)] = -1;
    // Hidden 0 → outputs [1, 0, -1]; hidden 1 → outputs [0, 2, 1]; biases [0.25, 0, 0].
    w[outputWeightIndex(TINY, 0, 0)] = 1;
    w[outputWeightIndex(TINY, 0, 2)] = -1;
    w[outputWeightIndex(TINY, 1, 1)] = 2;
    w[outputWeightIndex(TINY, 1, 2)] = 1;
    w[outputBiasIndex(TINY, 0)] = 0.25;

    const out = forwardPass(TINY, w, [1, 0.5], createBrainScratch(TINY));
    const h0 = 2 / 3; // softsign(1 + 1) = 2/3
    const h1 = -0.5; // softsign(-1)
    expect(Array.from(out)).toEqual([h0 * 1 + 0.25, h1 * 2, -h0 + h1]);
  });

  it('equals an independent reference and is repeatable, for random genomes and inputs', () => {
    const weight = fc.float({ min: -4, max: 4, noNaN: true });
    const input = fc.float({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        fc.array(weight, { minLength: weightCount(V1), maxLength: weightCount(V1) }),
        fc.array(input, { minLength: V1.inputs, maxLength: V1.inputs }),
        (ws, xs) => {
          const weights = Float32Array.from(ws);
          const inputs = Float32Array.from(xs);
          const before = Float32Array.from(weights);
          const scratch = createBrainScratch(V1);
          const first = Array.from(forwardPass(V1, weights, inputs, scratch));
          const second = Array.from(forwardPass(V1, weights, inputs, scratch));
          expect(first.every(Number.isFinite)).toBe(true);
          expect(first).toEqual(referenceForward(V1, weights, inputs));
          expect(second).toEqual(first);
          expect(weights).toEqual(before);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('argmaxAction', () => {
  it('picks the highest action output, ties to the lowest index', () => {
    expect(argmaxAction([0, 0, 0, 0, 0, 3, 1, 3, 0])).toBe(Action.EAT);
    expect(argmaxAction([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(Action.MOVE_N);
    expect(argmaxAction([-5, -1, -1, -9, -9, -9, -9, -9, -9])).toBe(Action.MOVE_E);
  });

  it('can choose ATTACK and SHARE (they resolve as STAY until Sprint 4.1)', () => {
    expect(argmaxAction([0, 0, 0, 0, 0, 0, 0, 1, 0])).toBe(Action.ATTACK);
    expect(argmaxAction([0, 0, 0, 0, 0, 0, 0, 0, 1])).toBe(Action.SHARE);
  });

  it('ignores outputs past the 9 actions, never lets NaN win, and falls back to STAY', () => {
    expect(argmaxAction([0, 0, 0, 0, 0, 0, 0, 0, 0, 99, 99])).toBe(Action.MOVE_N);
    expect(argmaxAction([Number.NaN, 1, 0, 0, 0, 0, 0, 0, 0])).toBe(Action.MOVE_E);
    expect(argmaxAction(new Array<number>(9).fill(Number.NaN))).toBe(Action.STAY);
    expect(argmaxAction(new Array<number>(9).fill(Number.NEGATIVE_INFINITY))).toBe(Action.STAY);
  });
});

describe('createBrainPolicy', () => {
  it('drives creatures from their sensors: DRINK exactly where water is reachable', () => {
    // Hidden 0 copies WATER_REACHABLE; DRINK's output = 4·softsign(water). All else 0, so a
    // creature away from water ties at 0 and argmax picks MOVE_N.
    const genome = createZeroGenome(V1);
    genome[inputWeightIndex(V1, 0, SensorIndex.WATER_REACHABLE)] = 1;
    genome[outputWeightIndex(V1, 0, Action.DRINK)] = 4;
    validateGenome(V1, genome);

    const world = createWorld({
      preset: 'small',
      seed: 5,
      policy: createBrainPolicy(V1, () => genome),
    });
    const policyStateBefore = world.rng.policy.getState();
    world.tick();

    const { biomes, width, height } = world.map;
    let drinkers = 0;
    for (const c of world.creatures) {
      const reachable = isWaterReachable(biomes, width, height, c.prevX, c.prevY);
      expect(c.intent).toBe(reachable ? Action.DRINK : Action.MOVE_N);
      if (reachable) drinkers++;
    }
    expect(drinkers).toBeGreaterThan(0);
    expect(drinkers).toBeLessThan(world.creatures.length);
    // The brain is pure: it never draws from the policy stream.
    expect(world.rng.policy.getState()).toEqual(policyStateBefore);
  });

  it('gives each creature its own genome via the lookup', () => {
    const east = createZeroGenome(V1);
    east[outputBiasIndex(V1, Action.MOVE_E)] = 1;
    const west = createZeroGenome(V1);
    west[outputBiasIndex(V1, Action.MOVE_W)] = 1;
    const world = createWorld({
      preset: 'small',
      seed: 5,
      policy: createBrainPolicy(V1, (c) => (c.tribeId === 0 ? east : west)),
    });
    world.tick();
    for (const c of world.creatures) {
      expect(c.intent).toBe(c.tribeId === 0 ? Action.MOVE_E : Action.MOVE_W);
    }
  });

  it('rejects specs that do not fit the creatures and genomes of the wrong length', () => {
    expect(() => createBrainPolicy({ ...V1, inputs: 17 }, () => new Float32Array(0))).toThrow(
      RangeError,
    );
    expect(() => createBrainPolicy({ ...V1, outputs: 8 }, () => new Float32Array(0))).toThrow(
      RangeError,
    );
    const world = createWorld({
      preset: 'small',
      seed: 5,
      policy: createBrainPolicy(V1, () => new Float32Array(332)),
    });
    expect(() => {
      world.tick();
    }).toThrow(RangeError);
  });
});
