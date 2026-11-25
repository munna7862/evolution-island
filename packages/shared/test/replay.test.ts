import {
  createEvolutionRun,
  DEFAULT_CONFIG,
  SIM_VERSION,
  type SimConfig,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  isReplayHashTick,
  parseReplay,
  playReplay,
  recordReplay,
  ReplayError,
  serializeReplay,
  type Replay,
} from '../src/index.js';

const QUICK: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 200 },
  },
  evolution: { ...DEFAULT_CONFIG.evolution, benchmarkInterval: 2 },
};

/** 700 ticks from generation 2 of a quick run: crosses generation ends (breeding, benchmark). */
function recorded(): Replay {
  const run = createEvolutionRun({ preset: 'small', seed: 13, config: QUICK });
  run.runGeneration();
  return recordReplay({
    preset: 'small',
    seed: 13,
    config: QUICK,
    start: run.captureState(),
    ticks: 700,
    hashEvery: 150,
  });
}

describe('replay files (Sprint 5.2)', () => {
  it('record hashes every hashEvery ticks and at the end', () => {
    const replay = recorded();
    expect(replay.hashes.map((h) => h.tick)).toEqual([150, 300, 450, 600, 700]);
    expect(isReplayHashTick(700, 150, 700)).toBe(true);
    expect(isReplayHashTick(699, 150, 700)).toBe(false);
    expect(replay.simVersion).toBe(SIM_VERSION);
  });

  it('play back exactly, also after a round trip through the file', () => {
    const replay = recorded();
    const direct = playReplay(replay);
    expect(direct.mismatch).toBeNull();
    expect(direct.matched).toBe(5);
    expect(direct.finalHash).toBe(replay.hashes.at(-1)!.hash);
    const fromFile = parseReplay(serializeReplay(replay));
    expect(playReplay(fromFile)).toEqual(direct);
  });

  it('finds a divergence at the first recorded hash that differs', () => {
    const replay = recorded();
    const tamperedHash = {
      ...replay,
      hashes: replay.hashes.map((h) => (h.tick === 450 ? { ...h, hash: '0123456789abcdef' } : h)),
    };
    expect(playReplay(tamperedHash).mismatch).toMatchObject({
      tick: 450,
      expected: '0123456789abcdef',
    });
    expect(playReplay(tamperedHash).matched).toBe(2);
    // A changed genome changes the world: caught at the first checkpoint.
    const text = serializeReplay(replay);
    const json = JSON.parse(text) as { start: { spawns: { genomes: number[][] }[] } };
    const g = json.start.spawns[0]!.genomes[0]!;
    g.fill(3);
    const changed = playReplay(parseReplay(JSON.stringify(json)));
    expect(changed.mismatch?.tick).toBe(150);
  });

  it('refuses other simVersions, a config that is not its hash, bad events and bad fields', () => {
    const text = serializeReplay(recorded());
    const edit = (f: (r: Record<string, unknown>) => void) => {
      const r = JSON.parse(text) as Record<string, unknown>;
      f(r);
      return JSON.stringify(r);
    };
    expect(() => parseReplay(edit((r) => (r['simVersion'] = SIM_VERSION - 1)))).toThrow(
      /simVersion .* would not play the same/,
    );
    expect(() =>
      parseReplay(
        edit((r) => {
          (r['config'] as { food: { regrowthRate: number } }).food.regrowthRate = 0.2;
        }),
      ),
    ).toThrow(/configHash/);
    expect(() => parseReplay(edit((r) => (r['events'] = [{ tick: 3 }])))).toThrow(
      /kind must be one of/,
    );
    const ev = (tick: number, kind = 'flood') => ({ tick, kind, x: 1, y: 1 });
    expect(() => parseReplay(edit((r) => (r['events'] = [ev(3, 'meteor')])))).toThrow(/kind/);
    expect(() => parseReplay(edit((r) => (r['events'] = [ev(700)])))).toThrow(/within 0/);
    expect(() => parseReplay(edit((r) => (r['events'] = [ev(5), ev(4)])))).toThrow(/sorted/);
    expect(() =>
      parseReplay(edit((r) => (r['events'] = [{ tick: 1, kind: 'flood', x: 0.5, y: 1 }]))),
    ).toThrow(/x/);
    expect(() => parseReplay(edit((r) => (r['ticks'] = 0)))).toThrow(ReplayError);
    expect(() => parseReplay('nope')).toThrow(ReplayError);
    expect(() =>
      recordReplay({ preset: 'small', seed: 1, config: QUICK, start: recorded().start, ticks: 0 }),
    ).toThrow(RangeError);
  });

  it('replays spectator events at their tick: same hashes, and they change the world (Sprint 7.2)', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 13, config: QUICK });
    run.runGeneration();
    const land = run.world.map.biomes.findIndex((b) => b === 3); // grass
    const width = run.world.map.width;
    const events = [
      { tick: 0, kind: 'winter' as const, x: 0, y: 0 },
      { tick: 40, kind: 'flood' as const, x: land % width, y: Math.floor(land / width) },
      { tick: 40, kind: 'foodZone' as const, x: 10, y: 12 },
      { tick: 260, kind: 'drought' as const, x: 30, y: 30 },
    ];
    const options = {
      preset: 'small' as const,
      seed: 13,
      config: QUICK,
      start: run.captureState(),
      ticks: 300,
      hashEvery: 50,
    };
    const withEvents = recordReplay({ ...options, events });
    expect(withEvents.events).toEqual(events);
    const fromFile = parseReplay(serializeReplay(withEvents));
    expect(fromFile.events).toEqual(events);
    const played = playReplay(fromFile);
    expect(played.mismatch).toBeNull();
    expect(played.finalHash).toBe(withEvents.hashes.at(-1)!.hash);
    // Without the events the same start plays differently from the first hash on.
    const without = recordReplay(options);
    expect(without.hashes[0]!.hash).not.toBe(withEvents.hashes[0]!.hash);
    // Dropping the events from the file is caught.
    expect(playReplay({ ...fromFile, events: [] }).mismatch?.tick).toBe(50);
    // Moving one event by a tick is caught too.
    const shifted = events.map((e) => (e.kind === 'drought' ? { ...e, tick: 261 } : e));
    expect(playReplay({ ...fromFile, events: shifted }).mismatch).not.toBeNull();
  });
});
