import {
  hallOfFameFileName,
  RunFileError,
  serializeCheckpoint,
  serializeGenome,
  type CheckpointContent,
} from '@evolution-island/shared';
import {
  brainSpecFromConfig,
  DEFAULT_CONFIG,
  hashConfig,
  weightCount,
  type EvolutionStart,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  checkpointsOfRun,
  defaultCheckpoint,
  loadCheckpoint,
  normalizeRunPath,
  onlyTribe,
  runNames,
  scanRunFiles,
  type FoundCheckpoint,
  type RunFileSource,
} from '../src/run-loader.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);
const CONFIG_HASH = hashConfig(DEFAULT_CONFIG);
const EXPECTED = { brain: SPEC, configHash: CONFIG_HASH };

function checkpoint(generation: number, seed: number | string = 42): CheckpointContent {
  return {
    configHash: CONFIG_HASH,
    preset: 'small',
    seed,
    generation,
    tribes: [0, 1].map((tribeId) => ({
      tribeId,
      alive: true,
      size: 2 + tribeId,
      hallOfFame: [
        { rank: 1, generation, benchmarkScore: 700, file: hallOfFameFileName(tribeId, 1) },
      ],
    })),
  };
}

function genomeText(value: number): string {
  return serializeGenome(SPEC, new Float32Array(weightCount(SPEC)).fill(value), CONFIG_HASH);
}

/** A run folder's files as sources, with read tracking. */
function runFolder(root: string, generations: number[], seed: number | string = 42) {
  const read: string[] = [];
  const files: Record<string, string> = { [`${root}run.json`]: '{}', [`${root}stats.csv`]: '' };
  for (const g of generations) {
    const dir = `${root}checkpoints/gen-${String(g).padStart(4, '0')}/`;
    files[`${dir}checkpoint.json`] = serializeCheckpoint(checkpoint(g, seed));
    files[`${dir}${hallOfFameFileName(0, 1)}`] = genomeText(g / 1000);
    files[`${dir}${hallOfFameFileName(1, 1)}`] = genomeText(-g / 1000);
  }
  const sources: RunFileSource[] = Object.entries(files).map(([path, text]) => ({
    path,
    text: () => {
      read.push(path);
      return Promise.resolve(text);
    },
  }));
  return { sources, read };
}

describe('normalizeRunPath', () => {
  it('uses / and drops leading / and ./', () => {
    expect(normalizeRunPath('/small-42/checkpoints/gen-0001/checkpoint.json')).toBe(
      'small-42/checkpoints/gen-0001/checkpoint.json',
    );
    expect(normalizeRunPath('.\\gen-0001\\checkpoint.json')).toBe('gen-0001/checkpoint.json');
  });
});

describe('scanRunFiles', () => {
  it('finds every checkpoint of a run folder, by generation, reading no genome files', async () => {
    const { sources, read } = runFolder('small-42/', [10, 1, 5]);
    const scan = await scanRunFiles(sources);
    expect(scan.checkpoints.map((c) => c.label)).toEqual([
      'Gen 1 · small-42',
      'Gen 5 · small-42',
      'Gen 10 · small-42',
    ]);
    expect(scan.checkpoints[2]!.dir).toBe('small-42/checkpoints/gen-0010/');
    expect(read.every((p) => p.endsWith('checkpoint.json'))).toBe(true);
    expect(defaultCheckpoint(scan)!.checkpoint.generation).toBe(10);
  });

  it('groups a folder of several runs by run, and picks the first run’s latest', async () => {
    const a = runFolder('sweep/small-2/', [1, 3], 2);
    const b = runFolder('sweep/small-1/', [1, 3], 1);
    const scan = await scanRunFiles([...a.sources, ...b.sources]);
    expect(scan.checkpoints.map((c) => c.label)).toEqual([
      'Gen 1 · small-1',
      'Gen 3 · small-1',
      'Gen 1 · small-2',
      'Gen 3 · small-2',
    ]);
    expect(defaultCheckpoint(scan)!.label).toBe('Gen 3 · small-1');
  });

  it('reports unreadable checkpoint files and finds nothing in unrelated files', async () => {
    const scan = await scanRunFiles([
      { path: 'x/checkpoint.json', text: () => Promise.resolve('{"format":"nope"}') },
      { path: 'notes.json', text: () => Promise.resolve('{}') },
    ]);
    expect(scan.checkpoints).toEqual([]);
    expect(scan.problems).toHaveLength(1);
    expect(scan.problems[0]).toMatch(/^x\/checkpoint\.json: Invalid checkpoint/);
    expect(defaultCheckpoint(scan)).toBeNull();
  });
});

describe('loadCheckpoint', () => {
  it('reads only the chosen checkpoint’s genome files and builds the start', async () => {
    const { sources, read } = runFolder('small-42/', [1, 5]);
    const scan = await scanRunFiles(sources);
    read.length = 0;
    const start = await loadCheckpoint(scan.checkpoints[1]!, sources, EXPECTED);
    expect(read.sort()).toEqual([
      'small-42/checkpoints/gen-0005/tribe-0-hof-1.genome.json',
      'small-42/checkpoints/gen-0005/tribe-1-hof-1.genome.json',
    ]);
    expect(start.generation).toBe(5);
    expect(start.tribes.map((t) => t.genomes.length)).toEqual([2, 3]);
    expect(start.tribes[0]!.genomes[0]![0]).toBeCloseTo(0.005, 6);
  });

  it('works on the loose files of one checkpoint folder', async () => {
    const { sources } = runFolder('', [7]);
    const loose = sources.map((s) => ({ ...s, path: s.path.split('/').pop()! }));
    const scan = await scanRunFiles(loose);
    const start = await loadCheckpoint(defaultCheckpoint(scan)!, loose, EXPECTED);
    expect(start.generation).toBe(7);
  });

  it('refuses a checkpoint whose genome files are missing or from another config', async () => {
    const { sources } = runFolder('r/', [2]);
    const scan = await scanRunFiles(sources);
    const withoutGenomes = sources.filter((s) => !s.path.endsWith('.genome.json'));
    await expect(loadCheckpoint(scan.checkpoints[0]!, withoutGenomes, EXPECTED)).rejects.toThrow(
      RunFileError,
    );
    await expect(
      loadCheckpoint(scan.checkpoints[0]!, sources, { ...EXPECTED, configHash: '0'.repeat(16) }),
    ).rejects.toThrow(/config/);
  });
});

describe('run browser helpers (Sprint 5.1)', () => {
  const found = (preset: 'small' | 'medium', seed: number, generation: number) =>
    ({
      label: `Gen ${generation} · ${preset}-${seed}`,
      dir: '',
      checkpoint: { preset, seed, generation },
    }) as unknown as FoundCheckpoint;

  it('lists runs in order and a run’s checkpoints', () => {
    const list = [
      found('small', 1, 1),
      found('small', 1, 5),
      found('medium', 2, 1),
      found('small', 3, 1),
    ];
    expect(runNames(list)).toEqual(['small-1', 'medium-2', 'small-3']);
    expect(checkpointsOfRun(list, 'small-1').map((c) => c.label)).toEqual([
      'Gen 1 · small-1',
      'Gen 5 · small-1',
    ]);
  });

  it('plays one tribe alone: the others are left out, its own genomes kept', () => {
    const g = new Float32Array(1);
    const start: EvolutionStart = {
      generation: 4,
      tribes: [
        { tribeId: 0, alive: true, genomes: [g, g], hallOfFame: [] },
        { tribeId: 1, alive: true, genomes: [g], hallOfFame: [] },
      ],
    };
    expect(onlyTribe(start, null)).toBe(start);
    const one = onlyTribe(start, 1);
    expect(one.tribes.map((t) => [t.alive, t.genomes.length])).toEqual([
      [false, 0],
      [true, 1],
    ]);
    expect(() => onlyTribe(start, 7)).toThrow(/no champions/);
  });
});
