// Sprint 5.1: a run captured between generations and restored continues exactly.
import { describe, expect, it } from 'vitest';
import {
  createEvolutionRun,
  createRngStream,
  DEFAULT_CONFIG,
  type EvolutionRun,
  type SimConfig,
} from '../src/index.js';

/** Small with 300-tick generations and benchmarks every 2: a few generations take milliseconds. */
const QUICK: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 300 },
  },
  evolution: { ...DEFAULT_CONFIG.evolution, benchmarkInterval: 2 },
};

function hashesUntil(run: EvolutionRun, generation: number): string[] {
  const hashes: string[] = [];
  while (run.generation <= generation && !run.finished) {
    run.runGeneration();
    hashes.push(`${run.generation}:${run.hash()}`);
  }
  return hashes;
}

describe('RngStream.setState', () => {
  it('puts a stream back where getState left it', () => {
    const a = createRngStream('x');
    a.nextUint32();
    const state = a.getState();
    const next = [a.nextUint32(), a.nextUint32()];
    a.setState(state);
    expect([a.nextUint32(), a.nextUint32()]).toEqual(next);
    expect(() => {
      a.setState([1, 2, 3] as unknown as [number, number, number, number]);
    }).toThrow(RangeError);
  });
});

describe('EvolutionRun captureState / resume', () => {
  it('continues bit for bit from any generation boundary', () => {
    const straight = createEvolutionRun({ preset: 'small', seed: 21, config: QUICK });
    const states = [straight.captureState()]; // before generation 1
    const worlds = [straight.world.hash()];
    const expected: string[] = [];
    while (straight.generation <= 7) {
      straight.runGeneration();
      expected.push(`${straight.generation}:${straight.hash()}`);
      states.push(straight.captureState());
      worlds.push(straight.world.hash());
    }
    for (const at of [0, 3, 6]) {
      const resumed = createEvolutionRun({
        preset: 'small',
        seed: 21,
        config: QUICK,
        resume: states[at]!,
      });
      expect(resumed.generation).toBe(at + 1);
      expect(resumed.world.hash()).toBe(worlds[at]);
      expect(hashesUntil(resumed, 7)).toEqual(expected.slice(at));
    }
  });

  it('gives the restored world the same state as the original at that point', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 5, config: QUICK });
    run.runGeneration();
    run.runGeneration();
    const state = run.captureState();
    const resumed = createEvolutionRun({ preset: 'small', seed: 5, config: QUICK, resume: state });
    expect(resumed.world.hash()).toBe(run.world.hash());
    expect(resumed.hash()).toBe(run.hash());
  });

  it('captures a copy: changing the run later does not change the state', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 5, config: QUICK });
    run.runGeneration();
    const state = run.captureState();
    const genome = state.spawns[0]!.genomes[0]!;
    const before = Float32Array.from(genome);
    run.world.creatures[0]!.genome[0] = 99;
    run.tribes[0]!.history.length = 0;
    expect(genome).toEqual(before);
    expect(state.tribes[0]!.history).toHaveLength(1);
  });

  it('only captures between generations, and refuses states for another map', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 5, config: QUICK });
    run.tick();
    expect(() => run.captureState()).toThrow(/between generations/);
    run.runGeneration();
    const state = run.captureState();
    expect(() =>
      createEvolutionRun({ preset: 'medium', seed: 5, config: QUICK, resume: state }),
    ).toThrow(/tribes/);
  });

  it('keeps a finished battle royale finished', () => {
    const br: SimConfig = {
      ...QUICK,
      creature: { ...QUICK.creature, baseHydrationDrain: 50, dehydrationHealthDrain: 100 },
      evolution: { ...QUICK.evolution, extinction: 'battle-royale', battleRoyaleFromGeneration: 1 },
    };
    const run = createEvolutionRun({ preset: 'small', seed: 5, config: br });
    run.runGeneration();
    expect(run.finished).toBe(true);
    const resumed = createEvolutionRun({
      preset: 'small',
      seed: 5,
      config: br,
      resume: run.captureState(),
    });
    expect(resumed.finished).toBe(true);
    expect(resumed.winner).toBe(run.winner);
    expect(resumed.tribes.map((t) => t.alive)).toEqual(run.tribes.map((t) => t.alive));
  });
});
