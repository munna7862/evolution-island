// Sprint 3.2 and 3.4 acceptance on the project's standard seed (plan §4): on a Small map, the
// benchmark-arena score rises from generation 1 to 50 (3.2) and at least doubles by generation 100
// (3.4, "it learns!"). Deterministic, so the margins below are exact, not statistical: a change in
// the rules or the default config that makes learning slower fails here. The multi-seed numbers
// are in docs/sprints/sprint-3.4.md.
import { describe, expect, it } from 'vitest';
import {
  Action,
  brainSpecFromConfig,
  createBenchmarkArena,
  createEvolutionRun,
  createZeroGenome,
  DEFAULT_CONFIG,
  outputBiasIndex,
  runBenchmark,
  type EvolutionRun,
} from '../src/index.js';

function benchmarkAt(run: EvolutionRun, generation: number): number[] {
  return run.tribes.map((t) => {
    const stats = t.history.find((h) => h.generation === generation)!;
    expect(stats.benchmarkScore).not.toBeNull();
    return stats.benchmarkScore!;
  });
}

const mean = (scores: readonly number[]): number =>
  scores.reduce((acc, s) => acc + s, 0) / scores.length;

/** Arena score of a brain that always picks STAY: the "learned nothing" floor. */
function stayOnlyScore(): number {
  const spec = brainSpecFromConfig(DEFAULT_CONFIG);
  const genome = createZeroGenome(spec);
  genome[outputBiasIndex(spec, Action.STAY)] = 1;
  return runBenchmark(createBenchmarkArena('small', DEFAULT_CONFIG), genome);
}

describe('evolution (Small, seed 42, default config)', () => {
  it('raises the benchmark-arena score: > 1.1× by generation 50, ≥ 2× by generation 100', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 42 });
    while (run.generation <= 100) run.runGeneration();

    const first = benchmarkAt(run, 1);
    const fiftieth = benchmarkAt(run, 50);
    const hundredth = benchmarkAt(run, 100);
    // Sprint 3.2: not a hair's-breadth win, at least 10% better.
    expect(mean(fiftieth)).toBeGreaterThan(1.1 * mean(first));
    // Sprint 3.4 bar: the mean at least doubles, also against a brain that only STAYs, and every
    // tribe gets ≥ 1.5× better on its own.
    expect(mean(hundredth)).toBeGreaterThanOrEqual(2 * mean(first));
    expect(mean(hundredth)).toBeGreaterThanOrEqual(2 * stayOnlyScore());
    hundredth.forEach((score, i) => {
      expect(score).toBeGreaterThanOrEqual(1.5 * first[i]!);
    });
  }, 120_000);
});
