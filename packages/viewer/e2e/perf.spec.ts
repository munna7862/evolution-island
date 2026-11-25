import { expect, test } from '@playwright/test';

/**
 * Browser performance check for plan §3.6 (Sprint 7.1). Opt-in (`PERF=1`): timings on shared CI
 * machines and software WebGL say little, so CI skips it and the numbers go in the sprint file.
 */
const PERF = process.env['PERF'] !== undefined;

const CASES = [
  { preset: 'large', speed: '20', fps: 60, ticksPerSec: 200 },
  { preset: 'huge', speed: '5', fps: 30, ticksPerSec: 50 },
] as const;

// The real GPU: the default project's software WebGL (SwiftShader) caps fps on its own.
test.use({ launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu'] } });

test.describe('performance (§3.6)', () => {
  test.skip(!PERF, 'set PERF=1 to measure');
  test.setTimeout(120_000);

  for (const c of CASES) {
    test(`${c.preset} at ${c.speed}x`, async ({ page }) => {
      await page.goto('/');
      await expect
        .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
        .toBeGreaterThan(0);
      await page.selectOption('#preset-select', c.preset);
      await expect.poll(() => page.evaluate(() => window.__ei?.preset)).toBe(c.preset);
      await page.click(`.speed-btn[data-speed="${c.speed}"]`);
      await page.waitForTimeout(4000);
      const samples: { fps: number; ticksPerSec: number; population: number }[] = [];
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(1000);
        samples.push(
          await page.evaluate(() => {
            const s = window.__ei!.getState();
            return { fps: s.fps, ticksPerSec: s.actualTicksPerSec, population: s.population };
          }),
        );
      }
      const mean = (f: (s: (typeof samples)[number]) => number): number =>
        samples.reduce((sum, s) => sum + f(s), 0) / samples.length;
      const result = {
        preset: c.preset,
        renderer: await page.evaluate(() => window.__ei!.rendererType),
        speed: c.speed,
        fps: mean((s) => s.fps),
        ticksPerSec: mean((s) => s.ticksPerSec),
        population: mean((s) => s.population),
      };
      console.log(JSON.stringify(result));
      // Small slack: the fps counter averages over windows that include frame-timing jitter.
      expect(result.fps).toBeGreaterThan(c.fps * 0.9);
      expect(result.ticksPerSec).toBeGreaterThan(c.ticksPerSec * 0.9);
    });
  }
});
