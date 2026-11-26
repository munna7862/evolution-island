import { serializeFeaturedRuns, type FeaturedRunsManifest } from '@evolution-island/shared';
import { describe, expect, it } from 'vitest';
import { featuredBaseUrl, featuredSources, fetchFeaturedRuns } from '../src/featured.js';

const MANIFEST: FeaturedRunsManifest = {
  simVersion: 15,
  configHash: '0123456789abcdef',
  runs: [
    {
      name: 'small-42',
      title: 'Small · seed 42 · 100 generations',
      preset: 'small',
      seed: 42,
      generations: [100],
      files: ['checkpoints/gen-0100/checkpoint.json'],
    },
  ],
};

describe('featured runs in the viewer (Phase 10)', () => {
  it('live in runs/ next to the page, also under a sub-path', () => {
    expect(featuredBaseUrl('https://u.github.io/evolution-island/?seed=1')).toBe(
      'https://u.github.io/evolution-island/runs/',
    );
    expect(featuredBaseUrl('http://localhost:4173/')).toBe('http://localhost:4173/runs/');
  });

  it('fetch the manifest, and nothing when the site has none', async () => {
    const asked: string[] = [];
    const found = await fetchFeaturedRuns('https://x.test/app/runs/', (url) => {
      asked.push(url);
      return Promise.resolve(serializeFeaturedRuns(MANIFEST));
    });
    expect(asked).toEqual(['https://x.test/app/runs/index.json']);
    expect(found).toEqual(MANIFEST);
    expect(
      await fetchFeaturedRuns('https://x.test/runs/', () => Promise.reject(new Error('404'))),
    ).toBeNull();
    expect(
      await fetchFeaturedRuns('https://x.test/runs/', () => Promise.resolve('<html>')),
    ).toBeNull();
  });

  it("turn a run's files into sources fetched only when read", async () => {
    const asked: string[] = [];
    const sources = featuredSources(MANIFEST.runs[0]!, 'https://x.test/app/runs/', (url) => {
      asked.push(url);
      return Promise.resolve('text');
    });
    expect(sources.map((s) => s.path)).toEqual(['checkpoints/gen-0100/checkpoint.json']);
    expect(asked).toEqual([]);
    expect(await sources[0]!.text()).toBe('text');
    expect(asked).toEqual([
      'https://x.test/app/runs/small-42/checkpoints/gen-0100/checkpoint.json',
    ]);
  });
});
