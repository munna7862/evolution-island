// Runs in Node (`pnpm test`) and inside Chromium (`pnpm test:browser`): keep it free of Node APIs.
import { describe, expect, it } from 'vitest';
import {
  argmaxAction,
  brainSpecFromConfig,
  createBrainPolicy,
  createBrainScratch,
  createEvolutionRun,
  createWorld,
  DEFAULT_CONFIG,
  forwardPass,
  readSensors,
  SENSOR_COUNT,
  SIM_VERSION,
  StateHasher,
  type BrainSpec,
  type DecisionPolicy,
  type SimConfig,
} from '../src/index.js';
import { GOLDEN, goldenBrainGenome } from './golden-hashes.js';

/**
 * The same steps as `createBrainPolicy` (sensors → forward pass → argmax), but every sensor
 * vector and raw output also goes into `hasher`, so the forward pass is pinned bit for bit.
 */
function recordingBrainPolicy(
  spec: BrainSpec,
  genome: Float32Array,
  hasher: StateHasher,
): DecisionPolicy {
  const sensors = new Float32Array(SENSOR_COUNT);
  const scratch = createBrainScratch(spec);
  return (world, creature) => {
    readSensors(world, creature, sensors);
    const outputs = forwardPass(spec, genome, sensors, scratch);
    hasher.writeUint32(world.tickCount).writeUint32(creature.id).writeFloat32Array(sensors);
    for (const value of outputs) hasher.writeFloat64(value);
    return argmaxAction(outputs);
  };
}

const MEMORY_CONFIG: SimConfig = {
  ...DEFAULT_CONFIG,
  brain: { ...DEFAULT_CONFIG.brain, memoryNeurons: 2 },
};

function hashesAt(
  ticks: Readonly<Record<number, string>>,
  policy?: DecisionPolicy,
  config: SimConfig = DEFAULT_CONFIG,
): Record<number, string> {
  const world = createWorld({
    preset: GOLDEN.preset,
    seed: GOLDEN.seed,
    config,
    ...(policy === undefined ? {} : { policy }),
  });
  const targets = Object.keys(ticks)
    .map(Number)
    .sort((a, b) => a - b);
  const actual: Record<number, string> = {};
  for (const target of targets) {
    while (world.tickCount < target) world.tick();
    actual[target] = world.hash();
  }
  return actual;
}

describe('golden state hashes (see golden-hashes.ts before changing anything here)', () => {
  it('are recorded for the current SIM_VERSION', () => {
    expect(GOLDEN.simVersion).toBe(SIM_VERSION);
  });

  it('reproduce the pinned map hash', () => {
    expect(createWorld({ preset: GOLDEN.preset, seed: GOLDEN.seed }).map.hash).toBe(GOLDEN.mapHash);
  });

  it('reproduce the pinned world hashes with the random policy (tick rules)', () => {
    expect(hashesAt(GOLDEN.randomPolicy)).toEqual(GOLDEN.randomPolicy);
  });

  it('reproduce the pinned world hashes with a fixed brain (sensors + forward pass)', () => {
    const spec = brainSpecFromConfig(DEFAULT_CONFIG);
    const genome = goldenBrainGenome(spec);
    const policy = createBrainPolicy(spec, () => genome);
    expect(hashesAt(GOLDEN.brainPolicy, policy)).toEqual(GOLDEN.brainPolicy);
  });

  it('reproduce the pinned world hashes with memory neurons (memory read-back + squash)', () => {
    const spec = brainSpecFromConfig(MEMORY_CONFIG);
    const genome = goldenBrainGenome(spec);
    const policy = createBrainPolicy(spec, () => genome);
    expect(hashesAt(GOLDEN.memoryPolicy, policy, MEMORY_CONFIG)).toEqual(GOLDEN.memoryPolicy);
  });

  it('reproduce every sensor vector and raw forward-pass output bit for bit', () => {
    const spec = brainSpecFromConfig(DEFAULT_CONFIG);
    const hasher = new StateHasher();
    const world = createWorld({
      preset: GOLDEN.preset,
      seed: GOLDEN.seed,
      policy: recordingBrainPolicy(spec, goldenBrainGenome(spec), hasher),
    });
    const digests: Record<number, string> = {};
    const worldHashes: Record<number, string> = {};
    for (const target of [100, 600] as const) {
      while (world.tickCount < target) world.tick();
      digests[target] = hasher.digest();
      worldHashes[target] = world.hash();
    }
    // Same world as the brainPolicy scenario, so the recording policy decides like the real one.
    expect(worldHashes).toEqual(GOLDEN.brainPolicy);
    expect(digests).toEqual(GOLDEN.brainOutputs);
  });

  it('reproduce the pinned evolution-run hashes (genetic algorithm + benchmark arena)', () => {
    const run = createEvolutionRun({ preset: GOLDEN.preset, seed: GOLDEN.seed });
    const actual: Record<number, string> = {};
    for (const generation of [2, 3, 4] as const) {
      while (run.generation < generation) run.runGeneration();
      actual[generation] = run.hash();
    }
    expect(actual).toEqual(GOLDEN.evolution);
  });
});
