import { DEFAULT_CONFIG, hashConfig, type SimConfig } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { applyConfigOverride, ConfigOverrideError, parseConfigOverride } from '../src/index.js';

function refusal(override: unknown): string {
  try {
    applyConfigOverride(override);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConfigOverrideError);
    return (error as Error).message;
  }
  return expect.fail('expected a ConfigOverrideError');
}

describe('applyConfigOverride', () => {
  it('returns an equal config for an empty override, without touching the base', () => {
    const merged = applyConfigOverride({});
    expect(merged).toEqual(DEFAULT_CONFIG);
    expect(merged).not.toBe(DEFAULT_CONFIG);
    expect(hashConfig(merged)).toBe(hashConfig(DEFAULT_CONFIG));
  });

  it('changes only the keys it names, nested objects key by key', () => {
    const merged = applyConfigOverride({
      evolution: { mutationSigma: 0.3, fitness: { foodEaten: 4 }, selection: 'tournament' },
      creature: { baseHydrationDrain: 0.25 },
    });
    expect(merged.evolution.mutationSigma).toBe(0.3);
    expect(merged.evolution.fitness).toEqual({ ...DEFAULT_CONFIG.evolution.fitness, foodEaten: 4 });
    expect(merged.evolution.selection).toBe('tournament');
    expect(merged.evolution.mutationRate).toBe(DEFAULT_CONFIG.evolution.mutationRate);
    expect(merged.creature).toEqual({ ...DEFAULT_CONFIG.creature, baseHydrationDrain: 0.25 });
    expect(merged.map).toEqual(DEFAULT_CONFIG.map);
    expect(DEFAULT_CONFIG.evolution.mutationSigma).toBe(0.2); // base untouched
    expect(hashConfig(merged)).not.toBe(hashConfig(DEFAULT_CONFIG));
  });

  it('merges presets one preset at a time and arrays as a whole', () => {
    const merged = applyConfigOverride({
      presets: { small: { generationLength: 900 } },
      map: { biomeMaxFood: [0, 0, 10, 50, 90, 0] },
    });
    expect(merged.presets.small).toEqual({
      ...DEFAULT_CONFIG.presets.small,
      generationLength: 900,
    });
    expect(merged.presets.medium).toEqual(DEFAULT_CONFIG.presets.medium);
    expect(merged.map.biomeMaxFood).toEqual([0, 0, 10, 50, 90, 0]);
  });

  it('accepts a full config, e.g. the one stored in a run.json', () => {
    const full = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as SimConfig;
    expect(hashConfig(applyConfigOverride(full))).toBe(hashConfig(DEFAULT_CONFIG));
  });

  it('merges onto another base when given one', () => {
    const base = applyConfigOverride({ evolution: { eliteCount: 4 } });
    const merged = applyConfigOverride({ evolution: { mutationRate: 0.1 } }, base);
    expect([merged.evolution.eliteCount, merged.evolution.mutationRate]).toEqual([4, 0.1]);
  });

  it('refuses unknown keys, naming the full path', () => {
    expect(refusal({ evolution: { mutationSigmaa: 1 } })).toBe(
      'unknown config key evolution.mutationSigmaa',
    );
    expect(refusal({ presets: { tiny: {} } })).toBe('unknown config key presets.tiny');
    expect(refusal(JSON.parse('{"__proto__": {"polluted": 1}}'))).toBe(
      'unknown config key __proto__',
    );
  });

  it('refuses wrong types and non-finite numbers', () => {
    expect(refusal(null)).toBe('the config override must be an object');
    expect(refusal([])).toBe('the config override must be an object');
    expect(refusal({ evolution: 3 })).toBe('evolution must be an object');
    expect(refusal({ evolution: { mutationRate: '0.1' } })).toBe(
      'evolution.mutationRate must be a finite number',
    );
    expect(refusal({ evolution: { mutationRate: Number.NaN } })).toBe(
      'evolution.mutationRate must be a finite number',
    );
    expect(refusal({ evolution: { crossover: 1 } })).toBe(
      'evolution.crossover must be true or false',
    );
    expect(refusal({ evolution: { benchmarkSeed: '' } })).toBe(
      'evolution.benchmarkSeed must be a non-empty string',
    );
  });

  it('refuses fractional or negative whole-number fields (they hash as integers)', () => {
    expect(refusal({ evolution: { eliteCount: 2.5 } })).toBe(
      'evolution.eliteCount must be a whole number ≥ 0',
    );
    expect(refusal({ presets: { small: { generationLength: -1 } } })).toBe(
      'presets.small.generationLength must be a whole number ≥ 0',
    );
    expect(
      applyConfigOverride({ evolution: { mutationSigma: 0.25 } }).evolution.mutationSigma,
    ).toBe(0.25);
  });

  it('refuses unknown enum values, preset id changes and wrong array lengths', () => {
    expect(refusal({ evolution: { selection: 'roulette' } })).toBe(
      'evolution.selection must be one of truncation, tournament',
    );
    expect(refusal({ evolution: { extinction: 'none' } })).toBe(
      'evolution.extinction must be one of respawn, battle-royale',
    );
    expect(refusal({ presets: { small: { id: 'medium' } } })).toBe(
      'presets.small.id cannot be changed (it is "small")',
    );
    expect(refusal({ map: { biomeMaxFood: [1, 2, 3] } })).toBe(
      'map.biomeMaxFood must be an array of 6 values',
    );
    expect(refusal({ map: { biomeMaxFood: [0, 0, 'x', 0, 0, 0] } })).toBe(
      'map.biomeMaxFood.2 must be a finite number',
    );
  });
});

describe('parseConfigOverride', () => {
  it('parses JSON text', () => {
    const merged = parseConfigOverride('{ "evolution": { "initialWeightRange": 1 } }');
    expect(merged.evolution.initialWeightRange).toBe(1);
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseConfigOverride('{ evolution: 1 }')).toThrow(
      /^the config override is not valid JSON/,
    );
    expect(() => parseConfigOverride('{ evolution: 1 }')).toThrow(ConfigOverrideError);
  });
});
