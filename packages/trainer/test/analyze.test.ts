import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Action, DEFAULT_CONFIG, type SimConfig } from '@evolution-island/sim-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeRun,
  findRunDirs,
  formatReport,
  summarize,
  trainSeed,
  type AnalyzeIo,
  type StatsRow,
} from '../src/index.js';

/** Small preset with 30-tick generations: a whole run takes milliseconds. */
const FAST: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 30 },
  },
  evolution: { ...DEFAULT_CONFIG.evolution, benchmarkInterval: 3 },
};

const io: AnalyzeIo = {
  readTextFile: (path) => readFileSync(path, 'utf8'),
  listDir: (path) => readdirSync(path),
  exists: (path) => existsSync(path),
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ei-analyze-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function train(outDir: string, seed: number, config: SimConfig = FAST, generations = 7): void {
  trainSeed({ preset: 'small', seed, generations, saveEvery: 3, outDir, force: false, config });
}

function statsRows(dir: string): StatsRow[] {
  return (JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')) as { rows: StatsRow[] }).rows;
}

describe('analyzeRun', () => {
  it('reads the last generation: winner = highest tribe score, late scores, champions', () => {
    const dir = join(tempDir(), 'small-9');
    train(dir, 9);
    const run = analyzeRun(dir, io);
    expect(run.generation).toBe(7);
    expect(run.seed).toBe('9');

    const last = statsRows(dir).filter((r) => r.generation === 7);
    const top = [...last].sort((a, b) => b.tribeScore - a.tribeScore || a.tribeId - b.tribeId)[0]!;
    expect(run.winner).toBe(top.tribeId);
    expect(run.tribesAlive).toBe(2);

    for (const t of run.tribes) {
      const mine = statsRows(dir).filter((r) => r.tribeId === t.tribeId);
      const benches = mine.flatMap((r) => (r.benchmarkScore === null ? [] : [r.benchmarkScore]));
      // Benchmarked at generations 1, 3 and 6 (interval 3): the late score is their mean.
      expect(benches).toHaveLength(3);
      const late = benches.slice(-3);
      expect(t.lateScore).toBeCloseTo(late.reduce((a, b) => a + b, 0) / late.length, 9);
      expect(t.firstBenchmark).toBe(benches[0]);
      expect(t.champion).not.toBeNull();
      expect(t.champion!.reproduced).toBe(true);
      const shares = t.champion!.actionShares;
      expect(shares).toHaveLength(9);
      expect(shares.reduce((a, s) => a + s, 0)).toBeCloseTo(1, 12);
      expect(shares[Action.ATTACK]).toBe(0);
      // A 30-tick generation can't reach fitness 700, so every tribe counts as locked in.
      expect(t.hardLockIn).toBe(true);
    }
  });

  it('counts tribes eliminated in battle royale as not alive', () => {
    const dir = join(tempDir(), 'small-4');
    // With 30-tick generations nobody dies of hunger or thirst; make thirst outpace any drinking
    // (−50 a tick vs +25 a DRINK) so every tribe dies out in generation 1.
    const deadly: SimConfig = {
      ...FAST,
      creature: { ...FAST.creature, baseHydrationDrain: 50, dehydrationHealthDrain: 100 },
      evolution: { ...FAST.evolution, extinction: 'battle-royale', battleRoyaleFromGeneration: 1 },
    };
    train(dir, 4, deadly);
    const run = analyzeRun(dir, io);
    expect(run.generation).toBe(1); // every tribe died out: the battle royale ends at once
    expect(run.tribesAlive).toBe(0);
    expect(run.tribes.every((t) => !t.alive)).toBe(true);
    expect(summarize([run]).runsWithTwoAlive).toBe(0);
  });

  it('refuses a run whose stored config does not match its config hash', () => {
    const dir = join(tempDir(), 'small-2');
    train(dir, 2, FAST, 1);
    const manifestPath = join(dir, 'run.json');
    const tampered: AnalyzeIo = {
      ...io,
      readTextFile: (path) => {
        const text = readFileSync(path, 'utf8');
        return path === manifestPath
          ? text.replace('"eatBiteSize": 20', '"eatBiteSize": 21')
          : text;
      },
    };
    expect(() => analyzeRun(dir, tampered)).toThrow(/does not match its config hash/);
  });
});

describe('findRunDirs, summarize and formatReport', () => {
  it('finds run folders in numeric order and sums the bar over them', () => {
    const root = tempDir();
    for (const seed of [10, 2, 1]) train(join(root, `small-${seed}`), seed);
    const found = findRunDirs(root, io);
    expect(found.map((d) => d.slice(root.length + 1))).toEqual(['small-1', 'small-2', 'small-10']);
    expect(findRunDirs(found[0]!, io)).toEqual([found[0]]);

    const runs = found.map((d) => analyzeRun(d, io));
    const summary = summarize(runs);
    expect(summary.runs).toBe(3);
    expect(summary.slotWins.reduce((a, n) => a + n, 0)).toBe(3);
    expect(summary.slotWins).toHaveLength(2);
    expect(summary.runsWithTwoAlive).toBe(3);
    expect(summary.champions).toBe(6);
    expect(summary.championsReproduced).toBe(6);
    expect(summary.meanActionShares.reduce((a, s) => a + s, 0)).toBeCloseTo(1, 12);
    expect(summary.maxStayShare).toBeGreaterThanOrEqual(summary.meanActionShares[Action.STAY]!);

    const report = formatReport(runs, summary);
    expect(report).toContain('small-1 gen 7');
    expect(report).toContain('Start-slot wins: slot 0:');
    expect(report).toContain('Champions: 6 (stored score reproduced: 6)');
  });
});
