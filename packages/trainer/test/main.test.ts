import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type SimConfig } from '@evolution-island/sim-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSeedJob,
  isSeedWorkerMessage,
  main,
  trainSeed,
  USAGE,
  type SeedJob,
  type SeedRunners,
} from '../src/index.js';

const FAST: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 20 },
  },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ei-cli-'));
  dirs.push(dir);
  return dir;
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l), cpus: 4 },
  };
}

/** Runs seeds in this thread (vitest has no built worker file), recording who ran what. */
function runners(fail: readonly number[] = []) {
  const calls: { kind: 'process' | 'worker'; job: SeedJob }[] = [];
  const run = (kind: 'process' | 'worker'): SeedRunners['inProcess'] => {
    return async (job, onProgress) => {
      calls.push({ kind, job });
      await Promise.resolve();
      if (fail.includes(Number(job.seed))) throw new Error(`seed ${String(job.seed)} broke`);
      return trainSeed({ ...job, config: FAST }, onProgress);
    };
  };
  return { calls, runners: { inProcess: run('process'), inWorker: run('worker') } };
}

describe('trainer CLI main()', () => {
  it('trains one seed in this thread into --out and prints progress + summary', async () => {
    const out = join(tempDir(), 'small-5');
    const t = io();
    const r = runners();
    const code = await main(
      ['--preset', 'small', '--seed', '5', '--generations', '3', '--save-every', '2', '--out', out],
      t.io,
      r.runners,
    );
    expect(code).toBe(0);
    expect(r.calls.map((c) => c.kind)).toEqual(['process']);
    expect(t.out[0]).toMatch(/^Evolution Island trainer/);
    expect(t.out.filter((l) => l.startsWith('[seed 5] gen'))).toHaveLength(3); // 1, 2, 3
    expect(t.out.at(-1)).toMatch(/^\[seed 5\] done: 3 generations/);
    expect(existsSync(join(out, 'run.json'))).toBe(true);
    expect(t.err).toEqual([]);
  });

  it('trains several seeds on workers, one folder each, plus a summary', async () => {
    const out = tempDir();
    const t = io();
    const r = runners();
    const code = await main(
      ['--preset', 'small', '--seeds', '3-5', '--generations', '2', '--out', out, '--quiet'],
      t.io,
      r.runners,
    );
    expect(code).toBe(0);
    expect(r.calls.map((c) => [c.kind, c.job.seed, c.job.outDir])).toEqual([
      ['worker', 3, join(out, 'small-3')],
      ['worker', 4, join(out, 'small-4')],
      ['worker', 5, join(out, 'small-5')],
    ]);
    expect(t.out.some((l) => l.includes(' gen '))).toBe(false); // --quiet
    const csv = readFileSync(join(out, 'summary.csv'), 'utf8').trimEnd().split('\n');
    expect(csv[0]).toBe(
      'seed,completedGenerations,ticks,elapsedSeconds,ticksPerSecond,meanFirstBenchmark,meanLastBenchmark,outDir',
    );
    expect(csv.slice(1).map((l) => l.split(',')[0])).toEqual(['3', '4', '5']);
    for (const seed of [3, 4, 5]) {
      expect(existsSync(join(out, `small-${seed}`, 'checkpoints', 'gen-0002'))).toBe(true);
    }
  });

  it('reports a failed seed with exit code 1 and still finishes the others', async () => {
    const out = tempDir();
    const t = io();
    const code = await main(
      ['--preset', 'small', '--seeds', '1-3', '--generations', '1', '--out', out],
      t.io,
      runners([2]).runners,
    );
    expect(code).toBe(1);
    expect(t.err).toEqual(['[seed 2] failed: seed 2 broke']);
    expect(existsSync(join(out, 'small-1', 'run.json'))).toBe(true);
    expect(existsSync(join(out, 'small-3', 'run.json'))).toBe(true);
  });

  it('prints usage: exit 0 for --help, 2 for a bad command line', async () => {
    const help = io();
    expect(await main(['--help'], help.io, runners().runners)).toBe(0);
    expect(help.out).toEqual([USAGE]);
    const bad = io();
    expect(await main(['--generations', 'lots'], bad.io, runners().runners)).toBe(2);
    expect(bad.err[0]).toMatch(/^Error: --generations must be a positive integer/);
    expect(bad.err[0]).toContain('Usage: pnpm train');
  });
});

describe('worker messages', () => {
  it('checks the job a worker receives', () => {
    const job: SeedJob = {
      preset: 'small',
      seed: 'x',
      generations: 1,
      saveEvery: 1,
      outDir: 'runs/x',
      force: false,
    };
    expect(assertSeedJob(job)).toBe(job);
    expect(() => assertSeedJob({ ...job, preset: 'gigantic' })).toThrow(TypeError);
    expect(() => assertSeedJob({ ...job, seed: null })).toThrow(TypeError);
    expect(() => assertSeedJob(null)).toThrow(TypeError);
  });

  it('recognises progress and done messages only', () => {
    expect(isSeedWorkerMessage({ type: 'progress', progress: {} })).toBe(true);
    expect(isSeedWorkerMessage({ type: 'done', summary: {} })).toBe(true);
    expect(isSeedWorkerMessage({ type: 'done' })).toBe(false);
    expect(isSeedWorkerMessage('done')).toBe(false);
  });
});
