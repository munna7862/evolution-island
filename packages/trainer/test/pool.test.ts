import { describe, expect, it } from 'vitest';
import { runPool } from '../src/index.js';

/** A job that finishes after `delay` macrotasks, tracking how many run at once. */
function tracker() {
  let running = 0;
  let peak = 0;
  const run = async (delay: number): Promise<number> => {
    running++;
    peak = Math.max(peak, running);
    for (let i = 0; i < delay; i++) await new Promise((r) => setTimeout(r, 0));
    running--;
    return delay * 10;
  };
  return { run, peak: () => peak };
}

describe('runPool', () => {
  it('never runs more than `concurrency` jobs at once', async () => {
    const t = tracker();
    await runPool([3, 1, 4, 1, 5, 9, 2, 6], 3, (d) => t.run(d));
    expect(t.peak()).toBe(3);
  });

  it('returns results in job order, whatever order they finish in', async () => {
    const t = tracker();
    const results = await runPool([5, 1, 3], 3, (d) => t.run(d));
    expect(results).toEqual([
      { ok: true, value: 50 },
      { ok: true, value: 10 },
      { ok: true, value: 30 },
    ]);
  });

  it('settles every job when one fails', async () => {
    const boom = new Error('boom');
    const results = await runPool([1, 2, 3, 4], 2, async (n) => {
      await Promise.resolve();
      if (n === 2) throw boom;
      return n;
    });
    expect(results).toEqual([
      { ok: true, value: 1 },
      { ok: false, error: boom },
      { ok: true, value: 3 },
      { ok: true, value: 4 },
    ]);
  });

  it('copes with no jobs and with more lanes than jobs', async () => {
    expect(await runPool([], 4, () => Promise.resolve(1))).toEqual([]);
    const t = tracker();
    await runPool([1, 1], 16, (d) => t.run(d));
    expect(t.peak()).toBe(2);
  });
});
