import { describe, expect, it } from 'vitest';
import { benchWorstCase, type BenchClock } from '../src/bench.js';

/** A clock that advances 10 ms of wall time and 8 ms of CPU time per reading pair. */
function fakeClock(): BenchClock {
  let wall = 0;
  let cpu = 0;
  return {
    wallMs: () => (wall += 10),
    cpuMs: () => (cpu += 8),
  };
}

describe('benchWorstCase (Sprint 7.1)', () => {
  it('keeps every creature alive, so the whole population runs every tick', () => {
    const r = benchWorstCase({ preset: 'small', ticks: 40, warmupTicks: 5, seed: 3 }, fakeClock());
    expect(r.creatures).toBe(50);
    expect(r.ticks).toBe(40);
  });

  it('turns the clocks into ticks per second', () => {
    const r = benchWorstCase({ preset: 'small', ticks: 4, warmupTicks: 0, seed: 3 }, fakeClock());
    // Two readings each: wall 10 → 20 ms, CPU 8 → 16 ms.
    expect(r.wallTicksPerSec).toBe(400);
    expect(r.cpuTicksPerSec).toBe(500);
  });

  it('is deterministic: the same options give the same world hash', () => {
    const a = benchWorstCase({ preset: 'small', ticks: 20, warmupTicks: 2, seed: 9 }, fakeClock());
    const b = benchWorstCase({ preset: 'small', ticks: 20, warmupTicks: 2, seed: 9 }, fakeClock());
    const c = benchWorstCase({ preset: 'small', ticks: 20, warmupTicks: 2, seed: 10 }, fakeClock());
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
  });
});
