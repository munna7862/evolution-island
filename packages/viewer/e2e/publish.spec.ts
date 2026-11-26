import { expect, test } from '@playwright/test';
import { createWorld, SIM_VERSION } from '../../sim-core/src/index.js';
import type {} from '../src/debug-hook.js';

/** Phase 10: the static site plays a pre-trained run, and seed links reproduce the same map. */
test.describe('Publishing (Phase 10)', () => {
  test('lists the featured runs, plays one, and its link plays it again', async ({ page }) => {
    await page.goto('./?paused=1');
    await expect
      .poll(() => page.evaluate(() => window.__ei?.featuredRuns.length ?? 0))
      .toBeGreaterThan(0);
    const name = await page.evaluate(() => window.__ei!.featuredRuns[0]!);
    await page.selectOption('#featured-select', name);
    await expect.poll(() => page.evaluate(() => window.__ei!.mode)).toBe('checkpoint');
    expect(await page.evaluate(() => window.__ei!.featuredRun)).toBe(name);
    const state = await page.evaluate(() => window.__ei!.getState());
    expect(state.checkpoint).not.toBeNull();
    expect(state.runMessageIsError).toBe(false);

    const link = new URL(page.url());
    expect(link.searchParams.get('run')).toBe(name);
    expect(link.searchParams.get('v')).toBe(String(SIM_VERSION));
    expect(link.searchParams.get('gen')).toBe(String(state.checkpoint!.generation));

    // Opening the link plays the same run and generation.
    await page.goto(link.toString());
    await expect.poll(() => page.evaluate(() => window.__ei?.featuredRun ?? null)).toBe(name);
    await expect
      .poll(() => page.evaluate(() => window.__ei!.checkpoint?.generation))
      .toBe(state.checkpoint!.generation);

    // An earlier generation: the link follows, and opening it plays that generation.
    await page.selectOption('#checkpoint-select', { index: 0 });
    await expect.poll(() => page.evaluate(() => window.__ei!.checkpoint?.generation)).toBe(1);
    const earlier = new URL(page.url());
    expect(earlier.searchParams.get('gen')).toBe('1');
    await page.goto(earlier.toString());
    await expect.poll(() => page.evaluate(() => window.__ei?.featuredRun ?? null)).toBe(name);
    await expect.poll(() => page.evaluate(() => window.__ei!.checkpoint?.generation)).toBe(1);

    // Generating a map leaves the featured run: the link drops run and gen.
    await page.click('#generate-btn');
    await expect.poll(() => page.evaluate(() => window.__ei!.mode)).toBe('random');
    const plain = new URL(page.url());
    expect(plain.searchParams.has('run')).toBe(false);
    expect(plain.searchParams.has('gen')).toBe(false);
  });

  test('a seed link makes the same map as Node does, and says when it was made by other rules', async ({
    page,
  }) => {
    await page.goto(`./?preset=small&seed=1234&v=${SIM_VERSION}&paused=1`);
    await expect.poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0)).toBeGreaterThan(0);
    const state = await page.evaluate(() => window.__ei!.getState());
    expect(state.preset).toBe('small');
    expect(state.seed).toBe(1234);
    expect(state.mapHash).toBe(createWorld({ preset: 'small', seed: 1234 }).map.hash);
    expect(state.runMessage).toBe('');

    await page.goto(`./?preset=small&seed=1234&v=${SIM_VERSION - 1}&paused=1`);
    await expect
      .poll(() => page.evaluate(() => window.__ei?.runMessage ?? ''))
      .toMatch(/made with simulation v\d+/);
  });
});
