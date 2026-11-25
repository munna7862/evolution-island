import {
  brainSpecFromConfig,
  createEvolutionRun,
  DEFAULT_CONFIG,
  hashConfig,
  SIM_VERSION,
  type SimConfig,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  assertRunStateCompatible,
  parseRunState,
  RunStateError,
  serializeRunState,
} from '../src/index.js';

const QUICK: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 40 },
  },
  evolution: { ...DEFAULT_CONFIG.evolution, benchmarkInterval: 1 },
};

function savedRun() {
  const run = createEvolutionRun({ preset: 'small', seed: 8, config: QUICK });
  run.runGeneration();
  run.runGeneration();
  return run;
}

describe('run-state files (Sprint 5.1)', () => {
  it('round-trip exactly: the resumed run continues like the original', () => {
    const run = savedRun();
    const text = serializeRunState({
      simVersion: SIM_VERSION,
      configHash: hashConfig(QUICK),
      brain: run.spec,
      state: run.captureState(),
    });
    const file = parseRunState(text);
    expect(file.state).toEqual(run.captureState());
    const resumed = createEvolutionRun({
      preset: 'small',
      seed: 8,
      config: QUICK,
      resume: file.state,
    });
    run.runGeneration();
    resumed.runGeneration();
    expect(resumed.hash()).toBe(run.hash());
  });

  it('refuses another simVersion, config or brain, and malformed files, saying why', () => {
    const run = savedRun();
    const file = {
      simVersion: SIM_VERSION,
      configHash: hashConfig(QUICK),
      brain: run.spec,
      state: run.captureState(),
    };
    const expected = { configHash: hashConfig(QUICK), brain: brainSpecFromConfig(QUICK) };
    expect(() => {
      assertRunStateCompatible(file, expected);
    }).not.toThrow();
    expect(() => {
      assertRunStateCompatible({ ...file, simVersion: SIM_VERSION - 1 }, expected);
    }).toThrow(/simVersion .* cannot be continued/);
    expect(() => {
      assertRunStateCompatible(file, { ...expected, configHash: '0000000000000000' });
    }).toThrow(/config/);
    expect(() => {
      assertRunStateCompatible(file, { ...expected, brain: { ...expected.brain, hidden: 9 } });
    }).toThrow(/brain/);
    expect(() => parseRunState('{')).toThrow(RunStateError);
    const good = JSON.parse(serializeRunState(file)) as { state: { spawns: unknown[] } };
    good.state.spawns = [{ tribeId: 0, genomes: [['x']] }];
    expect(() => parseRunState(JSON.stringify(good))).toThrow(/genomes\[0\]\[0\] must be a finite/);
    // An older file (e.g. simVersion 13, before the climate RNG stream) is refused for its
    // version, not for a state field it never had.
    const old = JSON.parse(serializeRunState(file)) as {
      simVersion: number;
      state: { rng: Record<string, unknown> };
    };
    old.simVersion = SIM_VERSION - 1;
    delete old.state.rng['climate'];
    expect(() => parseRunState(JSON.stringify(old))).toThrow(/simVersion .* cannot be continued/);
  });
});
