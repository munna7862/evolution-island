// Runs in Node (`pnpm test`) and inside Chromium (`pnpm test:browser`): keep it free of Node APIs.
import { describe, expect, it } from 'vitest';
import {
  argmaxAction,
  brainPolicyForConfig,
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
  storeMemoryOutputs,
  type BrainSpec,
  type DecisionPolicy,
  type SimConfig,
} from '../src/index.js';
import { brawlWorld, GOLDEN, goldenBrainGenome } from './golden-hashes.js';

/**
 * The same steps as `createBrainPolicy` (sensors and memory → forward pass → memory, argmax), but
 * every input vector and raw output also goes into `hasher`, so the forward pass is pinned bit
 * for bit.
 */
function recordingBrainPolicy(
  spec: BrainSpec,
  genome: Float32Array,
  hasher: StateHasher,
): DecisionPolicy {
  const inputs = new Float32Array(spec.inputs);
  const scratch = createBrainScratch(spec);
  return (world, creature) => {
    readSensors(world, creature, inputs);
    inputs.set(creature.memory, SENSOR_COUNT);
    const outputs = forwardPass(spec, genome, inputs, scratch);
    storeMemoryOutputs(outputs, creature.memory);
    hasher.writeUint32(world.tickCount).writeUint32(creature.id).writeFloat32Array(inputs);
    for (const value of outputs) hasher.writeFloat64(value);
    return argmaxAction(outputs);
  };
}

/** Memory off: the Sprint 3.4 brain (18 → 12 → 9), still pinned. */
const NO_MEMORY_CONFIG: SimConfig = {
  ...DEFAULT_CONFIG,
  brain: { ...DEFAULT_CONFIG.brain, memoryNeurons: 0 },
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

  it('reproduce the pinned world hashes with a fixed brain (sensors + memory + forward pass)', () => {
    const spec = brainSpecFromConfig(DEFAULT_CONFIG);
    const genome = goldenBrainGenome(spec);
    const policy = createBrainPolicy(spec, () => genome);
    expect(hashesAt(GOLDEN.brainPolicy, policy)).toEqual(GOLDEN.brainPolicy);
  });

  it('reproduce the pinned world hashes with signals on (calls, hearing, cost)', () => {
    const config: SimConfig = {
      ...DEFAULT_CONFIG,
      signals: { ...DEFAULT_CONFIG.signals, enabled: true },
    };
    const genome = goldenBrainGenome(brainSpecFromConfig(config));
    const policy = brainPolicyForConfig(config, () => genome);
    expect(hashesAt(GOLDEN.signalsPolicy, policy, config)).toEqual(GOLDEN.signalsPolicy);
  });

  it('reproduce the pinned world hashes with memory switched off (18 → 12 → 9 brain)', () => {
    const spec = brainSpecFromConfig(NO_MEMORY_CONFIG);
    const genome = goldenBrainGenome(spec);
    const policy = createBrainPolicy(spec, () => genome);
    expect(hashesAt(GOLDEN.noMemoryPolicy, policy, NO_MEMORY_CONFIG)).toEqual(
      GOLDEN.noMemoryPolicy,
    );
  });

  it('reproduce every input vector and raw forward-pass output bit for bit', () => {
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

  it('reproduce the pinned brawl hashes (combat, kills, sharing, territory)', () => {
    const world = brawlWorld();
    const actual: Record<number, string> = {};
    for (const target of [20, 60] as const) {
      while (world.tickCount < target) world.tick();
      actual[target] = world.hash();
    }
    expect(actual).toEqual(GOLDEN.brawl);
    expect(world.creatures.reduce((acc, c) => acc + c.stats.kills, 0)).toBe(23);
    expect(world.creatures.reduce((acc, c) => acc + c.stats.alliesHelped, 0)).toBe(8);
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
