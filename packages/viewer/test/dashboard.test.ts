import type { GenerationReport, TribeReport } from '@evolution-island/shared';
import { describe, expect, it } from 'vitest';
import { chartPaths, DashboardData } from '../src/dashboard.js';

function tribe(tribeId: number, over: Partial<TribeReport> = {}): TribeReport {
  return {
    tribeId,
    alive: true,
    population: 25,
    survivors: 1,
    avgFitness: 600,
    maxFitness: 900,
    territoryPct: 1.5,
    kills: 0,
    tribeScore: 10,
    benchmarkScore: null,
    ...over,
  };
}

const gen = (generation: number, tribes: TribeReport[]): GenerationReport => ({
  generation,
  tribes,
});

describe('DashboardData (Sprint 6.1)', () => {
  it('ranks the last generation by tribe score and keeps each tribe’s latest benchmark', () => {
    const d = new DashboardData();
    expect(d.state()).toEqual({ generation: null, rows: [] });
    d.add([
      gen(10, [tribe(0, { benchmarkScore: 700 }), tribe(1, { benchmarkScore: 650 })]),
      gen(11, [
        tribe(0, { tribeScore: 5, kills: 2 }),
        tribe(1, { tribeScore: 30, territoryPct: 4 }),
      ]),
    ]);
    const state = d.state();
    expect(state.generation).toBe(11);
    expect(state.rows.map((r) => r.tribeId)).toEqual([1, 0]);
    expect(state.rows[0]).toMatchObject({ territoryPct: 4, benchmarkScore: 650 });
    expect(state.rows[1]).toMatchObject({ kills: 2, benchmarkScore: 700 });
    // Repeats of known generations (e.g. a re-sent history) are ignored; reset clears.
    d.add([gen(11, [tribe(0, { tribeScore: 999 })])]);
    expect(d.state().rows[0]!.tribeId).toBe(1);
    d.reset();
    expect(d.generations()).toEqual([]);
  });

  it('gives each tribe a series over generations, null where it has no value', () => {
    const d = new DashboardData();
    d.add([
      gen(1, [tribe(0, { benchmarkScore: 500 }), tribe(1)]),
      gen(2, [tribe(0, { population: 30 })]), // tribe 1 eliminated
    ]);
    expect(d.series('benchmarkScore')).toEqual([
      { tribeId: 0, values: [500, null] },
      { tribeId: 1, values: [null, null] },
    ]);
    expect(d.series('population')[1]!.values).toEqual([25, null]);
  });
});

describe('chartPaths', () => {
  it('spreads points over the width and scales 0..max over the height', () => {
    const { paths, max } = chartPaths([{ tribeId: 0, values: [0, 50, 100] }], 104, 54, 2);
    expect(max).toBe(100);
    expect(paths[0]).toEqual([
      [
        { x: 2, y: 52 },
        { x: 52, y: 27 },
        { x: 102, y: 2 },
      ],
    ]);
  });

  it('breaks lines at nulls, or joins across them when asked', () => {
    const s = [{ tribeId: 0, values: [10, null, 20, 30] }];
    expect(chartPaths(s, 100, 50).paths[0]).toHaveLength(2);
    expect(chartPaths(s, 100, 50, 4, true).paths[0]).toHaveLength(1);
    expect(chartPaths([], 100, 50).paths).toEqual([]);
  });
});

describe('events feed (Sprint 6.3)', () => {
  const name = (id: number) => ['Amber', 'Sky'][id]!;

  it('announces extinction after survival, elimination, territory levels, records and a new leader', () => {
    const d = new DashboardData(name);
    d.add([
      gen(1, [
        tribe(0, { survivors: 3, tribeScore: 20, benchmarkScore: 600, maxFitness: 900 }),
        tribe(1, { survivors: 1, tribeScore: 10, territoryPct: 0.5 }),
      ]),
    ]);
    expect(d.feed().map((e) => e.text)).toEqual(['Amber reached 1% territory']);
    d.add([
      gen(2, [
        tribe(0, { survivors: 0, tribeScore: 5, benchmarkScore: 700, maxFitness: 950 }),
        tribe(1, { survivors: 2, tribeScore: 30, territoryPct: 5.5, maxFitness: 1200 }),
      ]),
    ]);
    expect(
      d
        .feed()
        .filter((e) => e.generation === 2)
        .map((e) => e.text),
    ).toEqual([
      'Sky takes the lead',
      'New fitness record: a Sky creature scored 1200',
      'Sky reached 5% territory',
      'Amber champion set a benchmark record: 700',
      'Amber went extinct and returns from its hall of fame',
    ]);
    // No repeats: same territory level, no new records, extinct again without survivors before.
    d.add([
      gen(3, [
        tribe(0, { survivors: 0, tribeScore: 1 }),
        tribe(1, { alive: false, territoryPct: 5.5, tribeScore: 40 }),
      ]),
    ]);
    expect(
      d
        .feed()
        .filter((e) => e.generation === 3)
        .map((e) => e.text),
    ).toEqual(['Sky was eliminated']);
    expect(d.feed()[0]!.generation).toBe(3); // newest first
    d.reset();
    expect(d.feed()).toEqual([]);
  });
});
