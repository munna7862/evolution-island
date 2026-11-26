import { SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { readShareParams, shareUrl, versionNotice } from '../src/share-link.js';

describe('share links (Phase 10)', () => {
  it('reads preset, seed, simVersion and featured run; ignores junk', () => {
    expect(readShareParams('?preset=large&seed=1234&v=15&run=medium-42&gen=80')).toEqual({
      preset: 'large',
      seed: 1234,
      simVersion: 15,
      run: 'medium-42',
      generation: 80,
    });
    expect(readShareParams('?preset=giant&seed=&v=x&run=../etc&gen=0')).toEqual({
      preset: null,
      seed: null,
      simVersion: null,
      run: null,
      generation: null,
    });
    expect(readShareParams('?seed=island').seed).toBe('island');
  });

  it("writes this build's simVersion, keeps other parameters, and adds or drops run", () => {
    const link = shareUrl('https://example.test/evolution-island/?speed=5&run=old', {
      preset: 'large',
      seed: 1234,
      run: null,
    });
    const url = new URL(link);
    expect(url.pathname).toBe('/evolution-island/');
    expect(url.searchParams.get('preset')).toBe('large');
    expect(url.searchParams.get('seed')).toBe('1234');
    expect(url.searchParams.get('v')).toBe(String(SIM_VERSION));
    expect(url.searchParams.get('speed')).toBe('5');
    expect(url.searchParams.has('run')).toBe(false);
    const withRun = new URL(
      shareUrl(link, { preset: 'medium', seed: 42, run: 'medium-42', generation: 80 }),
    );
    expect(withRun.searchParams.get('run')).toBe('medium-42');
    expect(withRun.searchParams.get('gen')).toBe('80');
    // No featured run, no generation.
    const back = new URL(shareUrl(withRun.toString(), { preset: 'medium', seed: 42, run: null }));
    expect(back.searchParams.has('gen')).toBe(false);
    // A link read back gives the same map parameters.
    expect(readShareParams(new URL(link).search)).toMatchObject({ preset: 'large', seed: 1234 });
  });

  it('warns only when a link names other rules', () => {
    expect(versionNotice(null)).toBeNull();
    expect(versionNotice(SIM_VERSION)).toBeNull();
    expect(versionNotice(SIM_VERSION - 1)).toMatch(/v\d+.*this site runs v\d+/);
  });
});
