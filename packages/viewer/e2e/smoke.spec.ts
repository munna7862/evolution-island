import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/debug-hook.js';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('Viewer v0', () => {
  test('loads, renders initial medium map, and exposes window.__ei debug hook', async ({
    page,
  }) => {
    const errors = trackErrors(page);

    await page.goto('/');
    await expect(page).toHaveTitle('Evolution Island');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evolution Island');
    await expect(page.getByText(/sim v\d+/)).toBeVisible();

    const canvas = page.locator('#viewport canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);

    await expect
      .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
      .toBeGreaterThanOrEqual(1);

    const state = await page.evaluate(() => window.__ei?.getState());
    expect(state).toBeDefined();
    expect(state!.preset).toBe('medium');
    expect(state!.seed).toBe(42);
    expect(state!.mapHash).toMatch(/^[0-9a-f]{16}$/);
    expect(state!.mapWidth).toBe(128);
    expect(state!.mapHeight).toBe(128);
    expect(state!.tick).toBe(0);
    expect(state!.population).toBe(0);
    expect(state!.chunkCount).toBe(4);
    expect(state!.visibleChunkCount).toBeGreaterThan(0);
    expect(['webgl', 'webgpu']).toContain(state!.rendererType);
    expect(state!.overlaysVisible).toBe(true);
    expect(errors).toEqual([]);
  });

  test('switching presets re-renders chunked textures and culls off-screen chunks on zoom', async ({
    page,
  }) => {
    const errors = trackErrors(page);

    await page.goto('/');
    await expect
      .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
      .toBeGreaterThanOrEqual(1);

    const initialHash = await page.evaluate(() => window.__ei!.mapHash);

    await page.selectOption('#preset-select', 'small');
    await expect.poll(() => page.evaluate(() => window.__ei?.preset)).toBe('small');
    const smallState = await page.evaluate(() => window.__ei!.getState());
    expect(smallState.mapWidth).toBe(64);
    expect(smallState.chunkCount).toBe(1);
    expect(smallState.mapHash).not.toBe(initialHash);

    await page.selectOption('#preset-select', 'large');
    await expect.poll(() => page.evaluate(() => window.__ei?.preset)).toBe('large');
    const largeState = await page.evaluate(() => window.__ei!.getState());
    expect(largeState.mapWidth).toBe(256);
    expect(largeState.chunkCount).toBe(16);
    expect(largeState.mapHash).not.toBe(smallState.mapHash);

    await page.selectOption('#preset-select', 'huge');
    await expect.poll(() => page.evaluate(() => window.__ei?.preset)).toBe('huge');
    const hugeState = await page.evaluate(() => window.__ei!.getState());
    expect(hugeState.mapWidth).toBe(512);
    expect(hugeState.chunkCount).toBe(64);
    expect(hugeState.visibleChunkCount).toBe(64);
    expect(hugeState.renderCount).toBeGreaterThanOrEqual(4);

    // Zoom deeply into the Huge map and verify off-screen chunk culling engages.
    const box = (await page.locator('#viewport canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -240);
    }
    await expect.poll(() => page.evaluate(() => window.__ei!.visibleChunkCount)).toBeLessThan(64);
    const culledVisible = await page.evaluate(() => window.__ei!.visibleChunkCount);
    expect(culledVisible).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('reproduces identical map hashes for UI seeds, Random button, and URL query params', async ({
    page,
  }) => {
    const errors = trackErrors(page);

    await page.goto('/?preset=small&seed=42');
    await expect
      .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
      .toBeGreaterThanOrEqual(1);

    const numericSeedState = await page.evaluate(() => window.__ei!.getState());
    expect(numericSeedState.preset).toBe('small');
    expect(numericSeedState.seed).toBe(42);

    await page.fill('#seed-input', 'sprint-1-2-seed');
    await page.click('#generate-btn');
    await expect.poll(() => page.evaluate(() => window.__ei?.seed)).toBe('sprint-1-2-seed');
    const firstHash = await page.evaluate(() => window.__ei!.mapHash);

    await page.fill('#seed-input', 'other-seed');
    await page.click('#generate-btn');
    await expect.poll(() => page.evaluate(() => window.__ei?.seed)).toBe('other-seed');
    const otherHash = await page.evaluate(() => window.__ei!.mapHash);
    expect(otherHash).not.toBe(firstHash);

    await page.click('#random-btn');
    await expect
      .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
      .toBeGreaterThanOrEqual(4);

    await page.goto(`/?preset=small&seed=sprint-1-2-seed`);
    await expect
      .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
      .toBeGreaterThanOrEqual(1);
    const urlReplay = await page.evaluate(() => window.__ei!.getState());
    expect(urlReplay.mapHash).toBe(firstHash);
    expect(errors).toEqual([]);
  });

  test('supports pan, wheel zoom, hover tile readout, overlays toggle, and reset view', async ({
    page,
  }) => {
    const errors = trackErrors(page);

    await page.goto('/');
    await expect
      .poll(() => page.evaluate(() => window.__ei?.renderCount ?? 0))
      .toBeGreaterThanOrEqual(1);

    const initialCam = await page.evaluate(() => window.__ei!.camera);
    const canvas = page.locator('#viewport canvas');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Hover over the center tile and check the status readout updates.
    await page.mouse.move(cx, cy);
    await expect(page.locator('#hover-info')).toContainText(/\(\d+, \d+\) · .+ · max food \d+/);

    // Drag to pan.
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 80, { steps: 5 });
    await page.mouse.up();

    const pannedCam = await page.evaluate(() => window.__ei!.camera);
    expect(pannedCam.x).not.toBeCloseTo(initialCam.x, 2);
    expect(pannedCam.y).not.toBeCloseTo(initialCam.y, 2);

    // Wheel zoom.
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -240);
    await expect
      .poll(() => page.evaluate(() => window.__ei!.camera.zoom))
      .toBeGreaterThan(initialCam.zoom);

    // Horizontal wheel (deltaY === 0) must not alter zoom.
    const zoomBeforeHoriz = await page.evaluate(() => window.__ei!.camera.zoom);
    await page.mouse.wheel(180, 0);
    const zoomAfterHoriz = await page.evaluate(() => window.__ei!.camera.zoom);
    expect(zoomAfterHoriz).toBeCloseTo(zoomBeforeHoriz, 6);

    // Double-click resets view.
    await page.mouse.dblclick(cx, cy);
    await expect
      .poll(() => page.evaluate(() => window.__ei!.camera.zoom))
      .toBeCloseTo(initialCam.zoom, 4);

    // Toggle overlays off and back on.
    await page.uncheck('#overlays-toggle');
    await expect.poll(() => page.evaluate(() => window.__ei!.overlaysVisible)).toBe(false);
    await page.check('#overlays-toggle');
    await expect.poll(() => page.evaluate(() => window.__ei!.overlaysVisible)).toBe(true);

    // Reset button also restores camera.
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -240);
    await expect
      .poll(() => page.evaluate(() => window.__ei!.camera.zoom))
      .toBeGreaterThan(initialCam.zoom);
    await page.click('#reset-view-btn');
    const resetCam = await page.evaluate(() => window.__ei!.camera);
    expect(resetCam.x).toBeCloseTo(initialCam.x, 4);
    expect(resetCam.y).toBeCloseTo(initialCam.y, 4);
    expect(resetCam.zoom).toBeCloseTo(initialCam.zoom, 4);
    expect(errors).toEqual([]);
  });
});
