// Sprint 3.5: memory neurons (plan §2.3, §2.4) — config switch, brain spec, feedback, migration.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Action,
  ACTION_COUNT,
  Biome,
  brainSpecFromConfig,
  createBenchmarkArena,
  createBrainPolicy,
  createBrainScratch,
  createEvolutionRun,
  createRngStream,
  createWorld,
  createZeroGenome,
  DEFAULT_CONFIG,
  forwardPass,
  hashConfig,
  hashWorld,
  hashWorldState,
  inputWeightIndex,
  memoryNeuronCount,
  migrateGenome,
  outputBiasIndex,
  outputWeightIndex,
  randomGenome,
  runBenchmark,
  SENSOR_COUNT,
  storeMemoryOutputs,
  weightCount,
  type BrainSpec,
  type SimConfig,
  type World,
} from '../src/index.js';
import { makeMiniMap } from './mini-map.js';

const MEMORY: SimConfig = {
  ...DEFAULT_CONFIG,
  brain: { ...DEFAULT_CONFIG.brain, memoryNeurons: 2 },
};
const OFF = brainSpecFromConfig(DEFAULT_CONFIG);
const ON = brainSpecFromConfig(MEMORY);
/** First memory input / output. */
const MEM_IN = SENSOR_COUNT;
const MEM_OUT = ACTION_COUNT;

function everyMemoryValue(world: World, check: (value: number) => void): void {
  for (const c of world.creatures) {
    for (const value of c.memory) check(value);
  }
}

describe('memory switch and brain spec', () => {
  it('is off by default; 2 memory neurons make a 20 → 12 → 11 brain (383 weights)', () => {
    expect(DEFAULT_CONFIG.brain.memoryNeurons).toBe(0);
    expect(OFF).toMatchObject({ inputs: 18, hidden: 12, outputs: 9 });
    expect(memoryNeuronCount(OFF)).toBe(0);
    expect(ON).toMatchObject({ inputs: 20, hidden: 12, outputs: 11 });
    expect(memoryNeuronCount(ON)).toBe(2);
    expect(weightCount(ON)).toBe(20 * 12 + 13 * 11);
    expect(weightCount(ON)).toBe(383);
  });

  it('is part of the config hash', () => {
    expect(hashConfig(MEMORY)).not.toBe(hashConfig(DEFAULT_CONFIG));
  });

  it('refuses memory counts that are not whole numbers ≥ 0, and unbalanced specs', () => {
    for (const memoryNeurons of [-1, 1.5, Number.NaN]) {
      const config = { ...DEFAULT_CONFIG, brain: { ...DEFAULT_CONFIG.brain, memoryNeurons } };
      expect(() => brainSpecFromConfig(config)).toThrow(RangeError);
    }
    expect(() => memoryNeuronCount({ ...ON, outputs: 10 })).toThrow(/2 memory inputs but 1/);
    expect(() => createBrainPolicy({ ...ON, inputs: 19 }, () => createZeroGenome(ON))).toThrow(
      RangeError,
    );
  });

  it('gives every creature as many memory values as the config says, all 0 at spawn', () => {
    const off = createWorld({ preset: 'small', seed: 5 });
    const on = createWorld({ preset: 'small', seed: 5, config: MEMORY });
    expect(off.creatures.every((c) => c.memory.length === 0)).toBe(true);
    expect(on.creatures.length).toBeGreaterThan(0);
    for (const c of on.creatures) expect(Array.from(c.memory)).toEqual([0, 0]);
  });

  it('refuses a brain with memory in a world whose creatures have none (and vice versa)', () => {
    const noMemory = createWorld({
      preset: 'small',
      seed: 5,
      policy: createBrainPolicy(ON, () => createZeroGenome(ON)),
    });
    expect(() => {
      noMemory.tick();
    }).toThrow(/0 memory values, brain spec needs 2/);
    const withMemory = createWorld({
      preset: 'small',
      seed: 5,
      config: MEMORY,
      policy: createBrainPolicy(OFF, () => createZeroGenome(OFF)),
    });
    expect(() => {
      withMemory.tick();
    }).toThrow(/2 memory values, brain spec needs 0/);
  });
});

describe('memory values stay within −1..1', () => {
  it('storeMemoryOutputs squashes any finite output with softsign', () => {
    const memory = new Float32Array(2);
    storeMemoryOutputs([9, 9, 9, 9, 9, 9, 9, 9, 9, 1, -3], memory);
    expect(Array.from(memory)).toEqual([0.5, -0.75]);
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        const outputs = new Array<number>(ACTION_COUNT).fill(0);
        outputs.push(x, -x);
        storeMemoryOutputs(outputs, memory);
        for (const value of memory) {
          expect(value).toBeGreaterThanOrEqual(-1);
          expect(value).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it('for any genome, including weights far beyond the mutation clamp', () => {
    const arena = createWorld({ preset: 'small', seed: 7, config: MEMORY, populate: false });
    const size = weightCount(ON);
    const extreme = fc.oneof(
      fc.double({ min: -4, max: 4, noNaN: true }),
      fc.constantFrom(3.4e38, -3.4e38, 1e6, -1e6),
    );
    fc.assert(
      fc.property(fc.array(extreme, { minLength: size, maxLength: size }), (weights) => {
        const genome = Float32Array.from(weights);
        const world = createWorld({
          preset: 'small',
          seed: 7,
          config: MEMORY,
          map: arena.map,
          policy: createBrainPolicy(ON, () => genome),
        });
        for (let t = 0; t < 40; t++) {
          world.tick();
          everyMemoryValue(world, (value) => {
            expect(Number.isFinite(value)).toBe(true);
            expect(Math.abs(value)).toBeLessThanOrEqual(1);
          });
        }
      }),
      { numRuns: 12 },
    );
  });

  it('through a whole generation of an evolving memory-on run', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 11, config: MEMORY });
    let ticks = 0;
    let nonZero = 0;
    for (;;) {
      run.tick();
      ticks++;
      if (run.generation !== 1) break;
      everyMemoryValue(run.world, (value) => {
        expect(Math.abs(value)).toBeLessThanOrEqual(1);
        if (value !== 0) nonZero++;
      });
    }
    expect(ticks).toBeGreaterThan(400);
    // Random generation-1 genomes do use their memory.
    expect(nonZero).toBeGreaterThan(0);
  });
});

describe('memory feedback', () => {
  it('stores the memory outputs and reads them back as inputs on the next tick', () => {
    // Memory output 0 has bias 1 → memory 0 becomes softsign(1) = 0.5 on the first tick.
    // Hidden 0 reads memory input 0 (weight 10) and drives EAT; STAY has bias 0.1. On tick 1 the
    // memory input is still 0, so the creature STAYs; on tick 2 it reads 0.5 and EATs.
    const genome = createZeroGenome(ON);
    genome[outputBiasIndex(ON, MEM_OUT)] = 1;
    genome[outputBiasIndex(ON, Action.STAY)] = 0.1;
    genome[inputWeightIndex(ON, 0, MEM_IN)] = 10;
    genome[outputWeightIndex(ON, 0, Action.EAT)] = 1;

    const map = makeMiniMap([
      [Biome.Grass, Biome.Grass, Biome.Grass],
      [Biome.Grass, Biome.Grass, Biome.Grass],
    ]);
    const world = createWorld({
      preset: 'small',
      seed: 'memory',
      config: MEMORY,
      map,
      populate: false,
      policy: createBrainPolicy(ON, () => genome),
    });
    const creature = world.spawnCreature(0, 1, 1, genome)!;

    world.tick();
    expect(creature.intent).toBe(Action.STAY);
    expect(Array.from(creature.memory)).toEqual([0.5, 0]);
    world.tick();
    expect(creature.intent).toBe(Action.EAT);
    expect(Array.from(creature.memory)).toEqual([0.5, 0]);
  });

  it('changes the world hash but not the state hash', () => {
    const world = createWorld({ preset: 'small', seed: 5, config: MEMORY });
    const full = hashWorld(world);
    const state = hashWorldState(world);
    world.creatures[3]!.memory[1] = 0.25;
    expect(hashWorld(world)).not.toBe(full);
    expect(hashWorldState(world)).toBe(state);
  });
});

describe('migrateGenome', () => {
  const original = randomGenome(OFF, createRngStream('migrate'), 4);
  const migrated = migrateGenome(OFF, ON, original);

  it('keeps every weight at its new index and gives the memory inputs and outputs weight 0', () => {
    expect(migrated).toHaveLength(weightCount(ON));
    let copied = 0;
    for (let h = 0; h < OFF.hidden; h++) {
      for (let i = 0; i < ON.inputs; i++) {
        const w = migrated[inputWeightIndex(ON, h, i)]!;
        expect(w).toBe(i < OFF.inputs ? original[inputWeightIndex(OFF, h, i)]! : 0);
        if (i < OFF.inputs) copied++;
      }
      for (let o = 0; o < ON.outputs; o++) {
        const w = migrated[outputWeightIndex(ON, h, o)]!;
        expect(w).toBe(o < OFF.outputs ? original[outputWeightIndex(OFF, h, o)]! : 0);
        if (o < OFF.outputs) copied++;
      }
    }
    for (let o = 0; o < ON.outputs; o++) {
      const w = migrated[outputBiasIndex(ON, o)]!;
      expect(w).toBe(o < OFF.outputs ? original[outputBiasIndex(OFF, o)]! : 0);
      if (o < OFF.outputs) copied++;
    }
    expect(copied).toBe(weightCount(OFF));
    expect(migrateGenome(OFF, OFF, original)).toEqual(original);
    expect(migrateGenome(OFF, OFF, original)).not.toBe(original);
  });

  it('gives the same action outputs bit for bit, whatever the memory inputs, and memory 0', () => {
    const offScratch = createBrainScratch(OFF);
    const onScratch = createBrainScratch(ON);
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: ON.inputs,
          maxLength: ON.inputs,
        }),
        (values) => {
          const inputs = Float32Array.from(values);
          const before = Array.from(forwardPass(OFF, original, inputs, offScratch));
          const after = Array.from(forwardPass(ON, migrated, inputs, onScratch));
          expect(after.slice(0, ACTION_COUNT)).toEqual(before);
          const memory = new Float32Array(2).fill(0.7);
          storeMemoryOutputs(after, memory);
          expect(Array.from(memory)).toEqual([0, 0]);
        },
      ),
    );
  });

  it('refuses to drop inputs/outputs or change the hidden layer, and wrong-length genomes', () => {
    expect(() => migrateGenome(ON, OFF, migrated)).toThrow(/only adds/);
    const wider: BrainSpec = { ...ON, hidden: 13 };
    expect(() => migrateGenome(OFF, wider, original)).toThrow(/13-hidden/);
    expect(() => migrateGenome(OFF, ON, original.subarray(1))).toThrow(RangeError);
  });
});

describe('a migrated genome behaves exactly as before migration', () => {
  /** Champions of a short memory-off run: they live longer than random genomes. */
  function trainedGenomes(): Float32Array[] {
    const run = createEvolutionRun({ preset: 'small', seed: 42 });
    while (run.generation <= 20) run.runGeneration();
    return run.world.creatures.map((c) => c.genome);
  }

  it('same state hash every 50 ticks through a whole generation, memory always 0', () => {
    const genomes = trainedGenomes();
    const spawns = (migrate: boolean) =>
      [0, 1].map((tribeId) => ({
        tribeId,
        genomes: genomes
          .filter((_, i) => i % 2 === tribeId)
          .map((g) => (migrate ? migrateGenome(OFF, ON, g) : g)),
      }));
    const before = createWorld({
      preset: 'small',
      seed: 42,
      populate: false,
      policy: createBrainPolicy(OFF, (c) => c.genome),
    });
    const after = createWorld({
      preset: 'small',
      seed: 42,
      config: MEMORY,
      populate: false,
      policy: createBrainPolicy(ON, (c) => c.genome),
    });
    before.startGeneration(1, spawns(false));
    after.startGeneration(1, spawns(true));
    expect(hashWorldState(after)).toBe(hashWorldState(before));

    let compared = 0;
    while (!before.isGenerationOver()) {
      before.tick();
      after.tick();
      everyMemoryValue(after, (value) => {
        expect(value).toBe(0);
      });
      if (before.tickCount % 50 === 0) {
        expect(hashWorldState(after)).toBe(hashWorldState(before));
        compared++;
      }
    }
    expect(after.isGenerationOver()).toBe(true);
    expect(hashWorldState(after)).toBe(hashWorldState(before));
    // The trained creatures live well past the ~520 ticks of an untrained one.
    expect(before.tickCount).toBeGreaterThan(1000);
    expect(compared).toBeGreaterThan(20);
    // The full hashes differ only because the config and genome layout do.
    expect(hashWorld(after)).not.toBe(hashWorld(before));
  }, 60_000);

  it('same benchmark-arena score', () => {
    const offArena = createBenchmarkArena('small', DEFAULT_CONFIG);
    const onArena = createBenchmarkArena('small', MEMORY);
    const genomes = trainedGenomes().slice(0, 3);
    for (const genome of genomes) {
      const score = runBenchmark(offArena, genome);
      expect(runBenchmark(onArena, migrateGenome(OFF, ON, genome))).toBe(score);
    }
  }, 60_000);
});

describe('memory-on evolution', () => {
  it('breeds 383-weight genomes and is deterministic', () => {
    const hashes = [0, 1].map(() => {
      const run = createEvolutionRun({ preset: 'small', seed: 3, config: MEMORY });
      while (run.generation <= 3) run.runGeneration();
      for (const c of run.world.creatures) expect(c.genome).toHaveLength(383);
      expect(run.tribes.every((t) => t.hallOfFame.length > 0)).toBe(true);
      return run.hash();
    });
    expect(hashes[1]).toBe(hashes[0]);
  }, 60_000);
});
