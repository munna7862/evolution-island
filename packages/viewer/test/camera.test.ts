import { describe, expect, it } from 'vitest';
import {
  fitMapToViewport,
  panCamera,
  screenToTile,
  TILE_WORLD_SIZE,
  zoomCameraAt,
} from '../src/renderer/camera.js';

describe('camera helpers', () => {
  it('fits and centers square, non-square, and huge maps even in small viewports', () => {
    const cam = fitMapToViewport(128, 128, 1024, 768);
    expect(cam.x).toBe((128 * TILE_WORLD_SIZE) / 2);
    expect(cam.y).toBe((128 * TILE_WORLD_SIZE) / 2);
    expect(cam.zoom).toBeGreaterThan(0);
    expect(cam.zoom * 128 * TILE_WORLD_SIZE).toBeLessThanOrEqual(768);

    const rect = fitMapToViewport(256, 64, 800, 600);
    expect(rect.x).toBe((256 * TILE_WORLD_SIZE) / 2);
    expect(rect.y).toBe((64 * TILE_WORLD_SIZE) / 2);
    expect(rect.zoom * 256 * TILE_WORLD_SIZE).toBeLessThanOrEqual(800);

    const hugeSmallViewport = fitMapToViewport(512, 512, 200, 200);
    expect(hugeSmallViewport.minZoom).toBeLessThanOrEqual(hugeSmallViewport.zoom);
    expect(hugeSmallViewport.zoom * 512 * TILE_WORLD_SIZE).toBeLessThanOrEqual(200);
  });

  it('pans opposite to screen delta, clamps to world bounds, and ignores invalid inputs', () => {
    const start = fitMapToViewport(64, 64, 800, 600);
    const worldSize = 64 * TILE_WORLD_SIZE;
    const panned = panCamera(start, 40, -20, worldSize, worldSize);
    expect(panned.x).toBeCloseTo(start.x - 40 / start.zoom, 9);
    expect(panned.y).toBeCloseTo(start.y + 20 / start.zoom, 9);

    const clamped = panCamera(start, -1_000_000, 1_000_000, worldSize, worldSize);
    expect(clamped.x).toBe(worldSize);
    expect(clamped.y).toBe(0);

    expect(panCamera({ ...start, zoom: 0 }, 10, 10, worldSize, worldSize).x).toBe(start.x);
    expect(panCamera(start, Number.NaN, 10, worldSize, worldSize)).toBe(start);
  });

  it('zooms around the cursor anchor, respects zoom limits, and ignores invalid factors/NaN', () => {
    const worldSize = 128 * TILE_WORLD_SIZE;
    const start = fitMapToViewport(128, 128, 1000, 800);
    const cursorX = 320;
    const cursorY = 210;

    const worldBeforeX = start.x + (cursorX - 500) / start.zoom;
    const worldBeforeY = start.y + (cursorY - 400) / start.zoom;

    const zoomed = zoomCameraAt(start, 2.5, cursorX, cursorY, 1000, 800, worldSize, worldSize);
    const worldAfterX = zoomed.x + (cursorX - 500) / zoomed.zoom;
    const worldAfterY = zoomed.y + (cursorY - 400) / zoomed.zoom;

    expect(zoomed.zoom).toBeCloseTo(start.zoom * 2.5, 9);
    expect(worldAfterX).toBeCloseTo(worldBeforeX, 9);
    expect(worldAfterY).toBeCloseTo(worldBeforeY, 9);

    const maxClamped = zoomCameraAt(start, 10_000, 500, 400, 1000, 800, worldSize, worldSize);
    expect(maxClamped.zoom).toBe(start.maxZoom);

    const minClamped = zoomCameraAt(start, 0.0001, 500, 400, 1000, 800, worldSize, worldSize);
    expect(minClamped.zoom).toBe(start.minZoom);

    expect(zoomCameraAt(start, 0, 500, 400, 1000, 800, worldSize, worldSize)).toBe(start);
    expect(zoomCameraAt(start, -2, 500, 400, 1000, 800, worldSize, worldSize)).toBe(start);
    expect(zoomCameraAt(start, Number.NaN, 500, 400, 1000, 800, worldSize, worldSize)).toBe(start);
  });

  it('converts screen coordinates to tile indices at corners and returns null when invalid/out of bounds', () => {
    const cam = fitMapToViewport(64, 64, 800, 600);
    expect(screenToTile(cam, 400, 300, 800, 600, 64, 64)).toEqual({ x: 32, y: 32 });
    expect(screenToTile(cam, 0, 0, 800, 600, 64, 64)).toBeNull();
    expect(screenToTile({ ...cam, zoom: 0 }, 400, 300, 800, 600, 64, 64)).toBeNull();
    expect(screenToTile(cam, Number.NaN, 300, 800, 600, 64, 64)).toBeNull();

    const oneToOne = { x: 0, y: 0, zoom: 1, minZoom: 0.1, maxZoom: 16 };
    expect(screenToTile(oneToOne, 100, 100, 200, 200, 64, 64)).toEqual({ x: 0, y: 0 });
    expect(
      screenToTile(
        oneToOne,
        100 + 63 * TILE_WORLD_SIZE + 1,
        100 + 63 * TILE_WORLD_SIZE + 1,
        200,
        200,
        64,
        64,
      ),
    ).toEqual({ x: 63, y: 63 });
  });
});
