// Sprint 4.3: signals (plan §2.3) — call output, "loudest ally call" sensors, commit and cost.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Action,
  ACTION_COUNT,
  Biome,
  brainPolicyForConfig,
  brainSpecFromConfig,
  CALL_SENSOR_COUNT,
  callValue,
  createBenchmarkArena,
  createEvolutionRun,
  createWorld,
  createZeroGenome,
  DEFAULT_CONFIG,
  hashConfig,
  hashWorldState,
  inputWeightIndex,
  memoryNeuronCount,
  migrateGenome,
  outputBiasIndex,
  outputWeightIndex,
  readCallSensors,
  runBenchmark,
  SENSOR_COUNT,
  weightCount,
  type SimConfig,
  type World,
} from '../src/index.js';
import { makeMiniMap } from './mini-map.js';

const SIGNALS: SimConfig = {
  ...DEFAULT_CONFIG,
  signals: { ...DEFAULT_CONFIG.signals, enabled: true },
};
const OFF = brainSpecFromConfig(DEFAULT_CONFIG);
const ON = brainSpecFromConfig(SIGNALS);
const MEMORY = DEFAULT_CONFIG.brain.memoryNeurons;
const CALL_IN = SENSOR_COUNT + MEMORY; // heard strength, then dx, dy
const CALL_OUT = ACTION_COUNT + MEMORY;
const RADIUS = SIGNALS.signals.callRadius;

function strip(width: number, config: SimConfig = SIGNALS): World {
  const map = makeMiniMap([new Array<Biome>(width).fill(Biome.Grass)]);
  return createWorld({ preset: 'small', seed: 'signals', map, populate: false, config });
}

function heard(world: World, id: number): number[] {
  const out = new Float32Array(CALL_SENSOR_COUNT);
  readCallSensors(world, world.creatures[id]!, out, 0);
  return Array.from(out);
}

describe('signals switch and brain spec', () => {
  it('is off by default; on, the memory brain grows to 23 → 12 → 12 = 432 weights', () => {
    expect(DEFAULT_CONFIG.signals.enabled).toBe(false);
    expect(ON).toMatchObject({ inputs: 23, hidden: 12, outputs: 12 });
    expect(weightCount(ON)).toBe(432);
    expect(memoryNeuronCount(ON, true)).toBe(MEMORY);
    expect(() => memoryNeuronCount(ON, false)).toThrow(RangeError);
    expect(hashConfig(SIGNALS)).not.toBe(hashConfig(DEFAULT_CONFIG));
  });
});

describe('callValue', () => {
  it('is max(0, softsign), silent below callThreshold', () => {
    expect(callValue(0, 0.5)).toBe(0);
    expect(callValue(-5, 0)).toBe(0);
    expect(callValue(1, 0.5)).toBe(0.5); // softsign(1) = 0.5, exactly at the threshold
    expect(callValue(0.99, 0.5)).toBe(0); // just below
    expect(callValue(3, 0.5)).toBe(0.75);
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        const call = callValue(x, 0.5);
        expect(call === 0 || (call >= 0.5 && call <= 1)).toBe(true);
      }),
    );
  });
});

describe('hearing (readCallSensors)', () => {
  it('hears the loudest ally within callRadius, fading with distance, and its offset', () => {
    const world = strip(40);
    world.spawnCreature(0, 10, 0); // listener, id 0
    world.spawnCreature(0, 15, 0)!.call = 0.8; // 5 tiles: 0.8 × (1 − 5/16) = 0.55
    world.spawnCreature(0, 7, 0)!.call = 0.6; // 3 tiles: 0.6 × (1 − 3/16) = 0.4875
    const [strength, dx, dy] = heard(world, 0);
    expect(strength).toBe(Math.fround(0.8 * (1 - 5 / RADIUS)));
    expect(dx).toBe(Math.fround(5 / RADIUS));
    expect(dy).toBe(0);
  });

  it('ignores enemies, silent allies, the dead, itself and allies beyond callRadius', () => {
    const world = strip(40);
    world.spawnCreature(0, 10, 0)!.call = 1; // the listener itself calls: not heard by itself
    world.spawnCreature(1, 11, 0)!.call = 1; // enemy
    world.spawnCreature(0, 12, 0); // silent ally
    const dead = world.spawnCreature(0, 13, 0)!;
    dead.call = 1;
    dead.alive = false;
    world.spawnCreature(0, 10 + RADIUS + 1, 0)!.call = 1; // out of range
    expect(heard(world, 0)).toEqual([0, 0, 0]);
    world.spawnCreature(0, 10 + RADIUS, 0)!.call = 1; // exactly at the radius: heard at 0 → silent
    expect(heard(world, 0)).toEqual([0, 0, 0]);
  });

  it('breaks equal strengths to the lowest id', () => {
    const world = strip(40);
    world.spawnCreature(0, 10, 0);
    world.spawnCreature(0, 14, 0)!.call = 0.8; // id 1, east
    world.spawnCreature(0, 6, 0)!.call = 0.8; // id 2, west, same distance
    expect(heard(world, 0)[1]).toBe(Math.fround(4 / RADIUS));
  });
});

describe('calls through the tick', () => {
  /**
   * Caller (tribe 0, x=0): its call output's bias is 10 → softsign 10/11 ≈ 0.909.
   * Listener (tribe 0, x=5): hidden 0 reads the heard strength (weight 10) and drives EAT; STAY
   * has bias 0.1. It eats only once it hears a call.
   */
  function scenario() {
    const caller = createZeroGenome(ON);
    caller[outputBiasIndex(ON, CALL_OUT)] = 10;
    const listener = createZeroGenome(ON);
    listener[outputBiasIndex(ON, Action.STAY)] = 0.1;
    listener[inputWeightIndex(ON, 0, CALL_IN)] = 10;
    listener[outputWeightIndex(ON, 0, Action.EAT)] = 1;
    const map = makeMiniMap([new Array<Biome>(8).fill(Biome.Grass)]);
    const world = createWorld({
      preset: 'small',
      seed: 'calls',
      map,
      populate: false,
      config: SIGNALS,
      policy: brainPolicyForConfig(SIGNALS, (c) => c.genome),
    });
    const a = world.spawnCreature(0, 0, 0, caller)!;
    const b = world.spawnCreature(0, 5, 0, listener)!;
    return { world, a, b };
  }

  it('is heard on the next tick, not the one it is made in', () => {
    const { world, a, b } = scenario();
    world.tick();
    expect(a.call).toBe(10 / 11);
    expect(b.intent).toBe(Action.STAY); // a's call wasn't committed yet when b decided
    world.tick();
    expect(b.intent).toBe(Action.EAT);
  });

  it('costs the caller callCost energy per tick and counts callsMade', () => {
    const { world, a, b } = scenario();
    const drain = DEFAULT_CONFIG.creature.baseEnergyDrain;
    for (let t = 0; t < 5; t++) world.tick();
    expect(a.stats.callsMade).toBe(5);
    expect(b.stats.callsMade).toBe(0);
    expect(a.energy).toBeCloseTo(100 - 5 * (drain + SIGNALS.signals.callCost), 9);
  });

  it('stops when the caller dies', () => {
    const { world, a } = scenario();
    world.tick();
    a.health = 0;
    world.tick();
    expect(a.alive).toBe(false);
    expect(a.call).toBe(0);
  });
});

describe('migration to a signals brain', () => {
  it('a migrated genome never calls and behaves exactly as before (state hash, benchmark)', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 42 });
    while (run.generation <= 15) run.runGeneration();
    const genomes = run.world.creatures.map((c) => c.genome);
    const spawns = (migrate: boolean) =>
      [0, 1].map((tribeId) => ({
        tribeId,
        genomes: genomes
          .filter((_, i) => i % 2 === tribeId)
          .map((g) => (migrate ? migrateGenome(OFF, ON, g) : g)),
      }));
    const make = (config: SimConfig) =>
      createWorld({
        preset: 'small',
        seed: 42,
        config,
        populate: false,
        policy: brainPolicyForConfig(config, (c) => c.genome),
      });
    const before = make(DEFAULT_CONFIG);
    const after = make(SIGNALS);
    before.startGeneration(1, spawns(false));
    after.startGeneration(1, spawns(true));
    while (!before.isGenerationOver()) {
      before.tick();
      after.tick();
      expect(after.creatures.every((c) => c.call === 0 && c.stats.callsMade === 0)).toBe(true);
      if (before.tickCount % 50 === 0) expect(hashWorldState(after)).toBe(hashWorldState(before));
    }
    expect(before.tickCount).toBeGreaterThan(600);
    expect(hashWorldState(after)).toBe(hashWorldState(before));

    const offArena = createBenchmarkArena('small', DEFAULT_CONFIG);
    const onArena = createBenchmarkArena('small', SIGNALS);
    for (const g of genomes.slice(0, 2)) {
      expect(runBenchmark(onArena, migrateGenome(OFF, ON, g))).toBe(runBenchmark(offArena, g));
    }
  }, 60_000);
});

describe('signals-on evolution', () => {
  it('breeds 432-weight genomes, calls, and is deterministic', () => {
    const results = [0, 1].map(() => {
      const run = createEvolutionRun({ preset: 'small', seed: 3, config: SIGNALS });
      let calls = 0;
      while (run.generation <= 2) {
        run.tick();
        for (const c of run.world.creatures) if (c.call > 0) calls++;
      }
      expect(run.world.creatures.every((c) => c.genome.length === 432)).toBe(true);
      return { hash: run.hash(), calls };
    });
    expect(results[0]!.calls).toBeGreaterThan(0);
    expect(results[1]).toEqual(results[0]);
  }, 60_000);
});
