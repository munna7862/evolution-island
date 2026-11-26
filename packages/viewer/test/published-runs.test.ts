import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  featuredRunsPlayable,
  FEATURED_RUNS_FILE,
  parseFeaturedRuns,
} from '@evolution-island/shared';
import { brainSpecFromConfig, DEFAULT_CONFIG, hashConfig } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { loadCheckpoint, scanRunFiles, type RunFileSource } from '../src/run-loader.js';

/**
 * The featured runs published with the site (Phase 10, `public/runs`) must play with this build:
 * a simVersion bump or a changed default config makes them stale. If this fails, retrain them
 * and run `pnpm featured` again (see docs/sprints/sprint-10.1.md).
 */
const RUNS = join(import.meta.dirname, '..', 'public', 'runs');
const expected = {
  brain: brainSpecFromConfig(DEFAULT_CONFIG),
  configHash: hashConfig(DEFAULT_CONFIG),
};

describe('published featured runs (Phase 10)', () => {
  const manifest = parseFeaturedRuns(readFileSync(join(RUNS, FEATURED_RUNS_FILE), 'utf8'));

  it('were trained by this build with the default config', () => {
    expect(manifest.runs.length).toBeGreaterThan(0);
    expect(featuredRunsPlayable(manifest, expected)).toBe(true);
  });

  for (const run of manifest.runs) {
    it(`${run.name}: every file is there and every published generation loads`, async () => {
      for (const file of run.files) expect(existsSync(join(RUNS, run.name, file))).toBe(true);
      const sources: RunFileSource[] = run.files.map((path) => ({
        path,
        text: () => Promise.resolve(readFileSync(join(RUNS, run.name, path), 'utf8')),
      }));
      const scan = await scanRunFiles(sources);
      expect(scan.problems).toEqual([]);
      expect(scan.checkpoints.map((c) => c.checkpoint.generation)).toEqual(run.generations);
      for (const found of scan.checkpoints) {
        const start = await loadCheckpoint(found, sources, expected);
        expect(start.tribes.length).toBeGreaterThan(0);
      }
    });
  }
});
