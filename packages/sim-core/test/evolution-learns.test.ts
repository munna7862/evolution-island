// Sprint 3.2 acceptance (plan §4): on a Small map with a fixed seed, the benchmark-arena score at
// generation 50 beats generation 1. Deterministic, so the margin below is exact, not statistical.
import { describe, expect, it } from 'vitest';
import { createEvolutionRun } from '../src/index.js';

describe('evolution (Small, seed 42, default config)', () => {
  it('raises the benchmark-arena score from generation 1 to generation 50', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 42 });
    while (run.generation <= 50) run.runGeneration();

    const meanBenchmark = (generation: number): number => {
      const scores = run.tribes.map((t) => {
        const stats = t.history.find((h) => h.generation === generation)!;
        expect(stats.benchmarkScore).not.toBeNull();
        return stats.benchmarkScore!;
      });
      return scores.reduce((acc, s) => acc + s, 0) / scores.length;
    };
    const first = meanBenchmark(1);
    const fiftieth = meanBenchmark(50);
    expect(fiftieth).toBeGreaterThan(first);
    // Not a hair's-breadth win: at least 10% better (Sprint 3.4 raises the bar to 2×).
    expect(fiftieth).toBeGreaterThan(1.1 * first);
  }, 60_000);
});
