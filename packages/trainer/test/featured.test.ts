import {
  checkpointDirName,
  hallOfFameFileName,
  parseFeaturedRuns,
  serializeCheckpoint,
} from '@evolution-island/shared';
import { DEFAULT_CONFIG, hashConfig, SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { buildFeaturedRuns, featuredName, type FeaturedIo } from '../src/featured.js';

/** An in-memory file system: paths → text. */
function memoryIo(files: Map<string, string>): FeaturedIo {
  return {
    readText: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    listDir: (path) => [
      ...new Set(
        [...files.keys()]
          .filter((p) => p.startsWith(`${path}/`))
          .map((p) => p.slice(path.length + 1).split('/')[0]!),
      ),
    ],
    exists: (path) => [...files.keys()].some((p) => p === path || p.startsWith(`${path}/`)),
    writeText: (path, text) => files.set(path, text),
    removeDir: (path) => {
      for (const p of [...files.keys()]) if (p.startsWith(`${path}/`)) files.delete(p);
    },
  };
}

/** A run folder with checkpoints every 10 generations up to `last` (2 tribes, 1 champion each). */
function addRun(files: Map<string, string>, dir: string, last: number, configHash?: string): void {
  for (const generation of [1, ...Array.from({ length: last / 10 }, (_, i) => (i + 1) * 10)]) {
    const folder = `${dir}/checkpoints/${checkpointDirName(generation)}`;
    files.set(
      `${folder}/checkpoint.json`,
      serializeCheckpoint({
        configHash: configHash ?? hashConfig(DEFAULT_CONFIG),
        preset: 'small',
        seed: 42,
        generation,
        tribes: [0, 1].map((tribeId) => ({
          tribeId,
          alive: true,
          size: 25,
          hallOfFame: [
            { rank: 1, generation, benchmarkScore: 100, file: hallOfFameFileName(tribeId, 1) },
          ],
        })),
      }),
    );
    for (const tribeId of [0, 1]) files.set(`${folder}/${hallOfFameFileName(tribeId, 1)}`, 'g');
  }
  files.set(`${dir}/stats.json`, '{}'); // not published
}

describe('pnpm featured (Phase 10)', () => {
  it('copies the picked generations with their genomes and writes the manifest', () => {
    const files = new Map<string, string>();
    addRun(files, 'runs/featured/Small-42', 100);
    files.set('out/old-run/stale.json', 'x');
    const manifest = buildFeaturedRuns(memoryIo(files), ['runs/featured/Small-42'], 'out');
    expect(manifest.simVersion).toBe(SIM_VERSION);
    expect(manifest.runs).toHaveLength(1);
    const run = manifest.runs[0]!;
    expect(run).toMatchObject({
      name: 'small-42',
      title: 'Small · seed 42 · 100 generations',
      generations: [1, 30, 50, 80, 100],
    });
    expect(run.files).toHaveLength(5 * 3);
    for (const f of run.files) expect(files.get(`out/small-42/${f}`)).toBeDefined();
    expect(files.has('out/old-run/stale.json')).toBe(false); // the out folder is emptied
    expect(files.has('out/small-42/stats.json')).toBe(false);
    expect(parseFeaturedRuns(files.get('out/index.json')!)).toEqual(manifest);
  });

  it('refuses runs this build cannot play, and clashing names', () => {
    const files = new Map<string, string>();
    addRun(files, 'runs/a', 20, '0123456789abcdef');
    expect(() => buildFeaturedRuns(memoryIo(files), ['runs/a'], 'out')).toThrow(
      /default config .*Train it again/,
    );
    const ok = new Map<string, string>();
    addRun(ok, 'x/run', 20);
    addRun(ok, 'y/run', 20);
    expect(() => buildFeaturedRuns(memoryIo(ok), ['x/run', 'y/run'], 'out')).toThrow(/twice|named/);
    expect(() => buildFeaturedRuns(memoryIo(ok), ['nope'], 'out')).toThrow(/checkpoints/);
  });

  it('names runs after their folder, link-safe', () => {
    expect(featuredName('runs\\featured\\Medium 42\\')).toBe('medium-42');
    expect(() => featuredName('runs/___')).toThrow(/folder name/);
  });
});
