import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  checkpointStart,
  parseCheckpoint,
  parseGenome,
  parseRunManifest,
  type LoadedGenome,
} from '@evolution-island/shared';
import {
  brainSpecFromConfig,
  createEvolutionRun,
  DEFAULT_CONFIG,
  hashConfig,
  SIM_VERSION,
  type SimConfig,
} from '@evolution-island/sim-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isCheckpointGeneration,
  statsToCsv,
  trainSeed,
  type SeedJob,
  type SeedProgress,
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

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ei-train-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function job(outDir: string, overrides: Partial<SeedJob> = {}): SeedJob {
  return {
    preset: 'small',
    seed: 9,
    generations: 7,
    saveEvery: 3,
    outDir,
    force: false,
    config: FAST,
    ...overrides,
  };
}

/** Every file under `dir`, as relative path → contents. */
function readTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(dir, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return files;
}

describe('isCheckpointGeneration', () => {
  it('saves generation 1, every N generations and the last one', () => {
    const saved = [1, 2, 3, 4, 5, 6, 7].filter((g) => isCheckpointGeneration(g, 3, g === 7));
    expect(saved).toEqual([1, 3, 6, 7]);
  });
});

describe('trainSeed', () => {
  it('writes checkpoints at 1, every N and the end, plus stats and run.json', () => {
    const out = tempDir();
    const progress: SeedProgress[] = [];
    const summary = trainSeed(job(out), (p) => progress.push(p));

    expect(summary.completedGenerations).toBe(7);
    expect(summary.checkpoints).toEqual([1, 3, 6, 7]);
    expect(summary.ticks).toBe(7 * 30);
    expect(progress.map((p) => p.generation)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(progress.filter((p) => p.checkpoint).map((p) => p.generation)).toEqual([1, 3, 6, 7]);

    const tree = readTree(out);
    expect([...tree.keys()].filter((p) => p.endsWith('checkpoint.json')).sort()).toEqual([
      'checkpoints/gen-0001/checkpoint.json',
      'checkpoints/gen-0003/checkpoint.json',
      'checkpoints/gen-0006/checkpoint.json',
      'checkpoints/gen-0007/checkpoint.json',
    ]);
    const manifest = parseRunManifest(tree.get('run.json')!);
    expect(manifest).toMatchObject({
      simVersion: SIM_VERSION,
      configHash: hashConfig(FAST),
      preset: 'small',
      seed: 9,
      generations: 7,
      completedGenerations: 7,
      checkpoints: [1, 3, 6, 7],
    });
    const csv = tree.get('stats.csv')!.trimEnd().split('\n');
    expect(csv[0]).toMatch(/^generation,tribeId,population,/);
    expect(csv).toHaveLength(1 + 7 * 2);
    const json = JSON.parse(tree.get('stats.json')!) as { rows: StatsRow[] };
    expect(json.rows.map((r) => [r.generation, r.tribeId]).slice(0, 3)).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it('saves each tribe’s hall of fame as genome files that play back as that tribe', () => {
    const out = tempDir();
    trainSeed(job(out));
    const dir = join(out, 'checkpoints', 'gen-0006');
    const checkpoint = parseCheckpoint(readFileSync(join(dir, 'checkpoint.json'), 'utf8'));
    expect(checkpoint.generation).toBe(6);
    const genomes = new Map<string, LoadedGenome>();
    for (const tribe of checkpoint.tribes) {
      // Benchmarked at generations 1, 3 and 6.
      expect(tribe.hallOfFame.map((e) => e.generation).sort()).toEqual([1, 3, 6]);
      expect(tribe.size).toBe(25);
      for (const entry of tribe.hallOfFame) {
        genomes.set(entry.file, parseGenome(readFileSync(join(dir, entry.file), 'utf8')));
      }
    }
    const start = checkpointStart(checkpoint, genomes, {
      brain: brainSpecFromConfig(FAST),
      configHash: hashConfig(FAST),
    });
    const run = createEvolutionRun({ preset: 'small', seed: 9, config: FAST, start });
    expect(run.generation).toBe(6);
    expect(run.world.creatures).toHaveLength(50);
  });

  it('is deterministic: same job → identical checkpoints and stats', () => {
    const a = readTree(
      (() => {
        const d = tempDir();
        trainSeed(job(d));
        return d;
      })(),
    );
    const b = readTree(
      (() => {
        const d = tempDir();
        trainSeed(job(d));
        return d;
      })(),
    );
    a.delete('run.json'); // carries wall-clock timing
    b.delete('run.json');
    expect(b).toEqual(a);
    const other = readTree(
      (() => {
        const d = tempDir();
        trainSeed(job(d, { seed: 10 }));
        return d;
      })(),
    );
    expect(other.get('stats.csv')).not.toEqual(a.get('stats.csv'));
  });

  it('refuses to overwrite a run unless forced, and then starts clean', () => {
    const out = tempDir();
    trainSeed(job(out, { generations: 7 }));
    expect(() => trainSeed(job(out))).toThrow(/--force/);
    trainSeed(job(out, { generations: 2, force: true }));
    expect(existsSync(join(out, 'checkpoints', 'gen-0006'))).toBe(false);
    expect(parseRunManifest(readFileSync(join(out, 'run.json'), 'utf8')).checkpoints).toEqual([
      1, 2,
    ]);
  });

  it('stops when a battle royale ends and saves that generation', () => {
    const out = tempDir();
    const royale: SimConfig = {
      ...FAST,
      presets: {
        ...FAST.presets,
        small: { ...FAST.presets.small, generationLength: 1500 },
      },
      evolution: { ...FAST.evolution, extinction: 'battle-royale' },
    };
    // Random generation-1 brains all die before 1,500 ticks, so one tribe outlives the other.
    const summary = trainSeed(job(out, { config: royale, generations: 50 }));
    expect(summary.completedGenerations).toBe(1);
    expect(summary.checkpoints).toEqual([1]);
    const checkpoint = parseCheckpoint(
      readFileSync(join(out, 'checkpoints', 'gen-0001', 'checkpoint.json'), 'utf8'),
    );
    expect(checkpoint.tribes.filter((t) => t.alive)).toHaveLength(1);
    expect(checkpoint.tribes.find((t) => !t.alive)!.size).toBe(0);
  });
});

describe('statsToCsv', () => {
  it('prints numbers exactly and missing benchmark scores as empty cells', () => {
    const row: StatsRow = {
      generation: 2,
      tribeId: 1,
      population: 25,
      survivors: 3,
      deaths: 22,
      avgFitness: 512.25,
      maxFitness: 900,
      foodGathered: 0.1 + 0.2,
      territoryPct: 0,
      kills: 0,
      tribeScore: 3.3,
      benchmarkScore: null,
      nextSize: 25,
    };
    expect(statsToCsv([row]).split('\n')[1]).toBe(
      '2,1,25,3,22,512.25,900,0.30000000000000004,0,0,3.3,,25',
    );
  });
});
