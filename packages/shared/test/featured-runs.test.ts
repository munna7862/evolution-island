import { describe, expect, it } from 'vitest';
import {
  featuredRunsPlayable,
  parseFeaturedRuns,
  pickFeaturedGenerations,
  serializeFeaturedRuns,
  type FeaturedRunsManifest,
} from '../src/index.js';

const MANIFEST: FeaturedRunsManifest = {
  simVersion: 15,
  configHash: '0123456789abcdef',
  runs: [
    {
      name: 'medium-42',
      title: 'Medium · seed 42 · 300 generations',
      preset: 'medium',
      seed: 42,
      generations: [1, 300],
      files: [
        'checkpoints/gen-0001/checkpoint.json',
        'checkpoints/gen-0300/tribe-0-hof-1.genome.json',
      ],
    },
  ],
};

describe('featured runs manifest (Phase 10)', () => {
  it('round-trips', () => {
    expect(parseFeaturedRuns(serializeFeaturedRuns(MANIFEST))).toEqual(MANIFEST);
  });

  it('refuses unsafe names and paths, duplicates and bad headers', () => {
    const edit = (
      f: (m: { runs: Record<string, unknown>[] } & Record<string, unknown>) => void,
    ) => {
      const m = JSON.parse(serializeFeaturedRuns(MANIFEST)) as {
        runs: Record<string, unknown>[];
      } & Record<string, unknown>;
      f(m);
      return JSON.stringify(m);
    };
    expect(() => parseFeaturedRuns(edit((m) => (m.runs[0]!['name'] = '../up')))).toThrow(/name/);
    expect(() => parseFeaturedRuns(edit((m) => (m.runs[0]!['files'] = ['../secret'])))).toThrow(
      /relative paths/,
    );
    expect(() => parseFeaturedRuns(edit((m) => (m.runs[0]!['files'] = ['/abs.json'])))).toThrow(
      /relative paths/,
    );
    expect(() => parseFeaturedRuns(edit((m) => (m.runs[0]!['files'] = ['a\b.json'])))).toThrow(
      /relative paths/,
    );
    expect(() => parseFeaturedRuns(edit((m) => m.runs.push(m.runs[0]!)))).toThrow(/twice/);
    expect(() => parseFeaturedRuns(edit((m) => (m['format'] = 'x')))).toThrow(/format/);
    expect(() => parseFeaturedRuns('{')).toThrow(/JSON/);
  });

  it('is playable only by the same rules and default config', () => {
    expect(featuredRunsPlayable(MANIFEST, { configHash: '0123456789abcdef', simVersion: 15 })).toBe(
      true,
    );
    expect(featuredRunsPlayable(MANIFEST, { configHash: 'ffffffffffffffff', simVersion: 15 })).toBe(
      false,
    );
    expect(featuredRunsPlayable(MANIFEST, { configHash: '0123456789abcdef', simVersion: 14 })).toBe(
      false,
    );
  });

  it('publishes the first, last and quarter-way generations', () => {
    const every10 = [1, ...Array.from({ length: 10 }, (_, i) => (i + 1) * 10)];
    expect(pickFeaturedGenerations(every10)).toEqual([1, 30, 50, 80, 100]);
    expect(pickFeaturedGenerations([100, 1, 50])).toEqual([1, 50, 100]);
    // 2.5 is as near 2 as 3: ties go to the earlier generation.
    expect(pickFeaturedGenerations([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 4, 5, 7]);
    expect(pickFeaturedGenerations([])).toEqual([]);
  });
});
