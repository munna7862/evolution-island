import { DEFAULT_CONFIG, generateMap } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { fitMapToViewport, TILE_WORLD_SIZE } from '../src/renderer/camera.js';
import {
  buildChunkPixels,
  CHUNK_SIZE,
  computeChunkGrid,
  computeVisibleChunkIndices,
} from '../src/renderer/chunks.js';
import { tileColorRgb } from '../src/renderer/palette.js';

describe('chunked terrain helpers', () => {
  it('partitions all 4 presets into 64x64 chunks, handles partial edge chunks, and guards invalid inputs', () => {
    expect(computeChunkGrid(64, 64)).toHaveLength(1);
    expect(computeChunkGrid(128, 128)).toHaveLength(4);
    expect(computeChunkGrid(256, 256)).toHaveLength(16);
    expect(computeChunkGrid(512, 512)).toHaveLength(64);

    expect(computeChunkGrid(0, 64)).toEqual([]);
    expect(computeChunkGrid(64, -1)).toEqual([]);
    expect(computeChunkGrid(Number.POSITIVE_INFINITY, 64)).toEqual([]);

    const irregular = computeChunkGrid(100, 70, CHUNK_SIZE);
    expect(irregular).toHaveLength(4);
    expect(irregular[0]).toEqual({
      id: 0,
      cx: 0,
      cy: 0,
      tileX: 0,
      tileY: 0,
      tilesW: 64,
      tilesH: 64,
    });
    expect(irregular[1]).toEqual({
      id: 1,
      cx: 1,
      cy: 0,
      tileX: 64,
      tileY: 0,
      tilesW: 36,
      tilesH: 64,
    });
    expect(irregular[2]).toEqual({
      id: 2,
      cx: 0,
      cy: 1,
      tileX: 0,
      tileY: 64,
      tilesW: 64,
      tilesH: 6,
    });
    expect(irregular[3]).toEqual({
      id: 3,
      cx: 1,
      cy: 1,
      tileX: 64,
      tileY: 64,
      tilesW: 36,
      tilesH: 6,
    });
  });

  it('builds valid RGBA pixels with accurate offsets on multi-chunk and partial chunks', () => {
    const map = generateMap({ preset: 'medium', seed: 42 });
    const chunks = computeChunkGrid(map.width, map.height);
    const seChunk = chunks[3]!; // cx: 1, cy: 1 -> tileX: 64, tileY: 64
    const pixels = buildChunkPixels(map, seChunk, DEFAULT_CONFIG);

    expect(pixels).toHaveLength(64 * 64 * 4);
    const colors = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i + 3]).toBe(255);
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
    expect(colors.size).toBeGreaterThanOrEqual(4);

    // Spot-check interior texel (10, 15) in SE chunk maps to map tile (74, 79).
    const mapIdx = (64 + 15) * map.width + (64 + 10);
    const [er, eg, eb] = tileColorRgb(
      map.biomes[mapIdx]!,
      map.maxFood[mapIdx]!,
      DEFAULT_CONFIG.map,
    );
    const pOut = (15 * 64 + 10) * 4;
    expect([pixels[pOut], pixels[pOut + 1], pixels[pOut + 2], pixels[pOut + 3]]).toEqual([
      er,
      eg,
      eb,
      255,
    ]);

    const partial = { id: 0, cx: 0, cy: 0, tileX: 100, tileY: 100, tilesW: 28, tilesH: 28 };
    expect(buildChunkPixels(map, partial)).toHaveLength(28 * 28 * 4);
  });

  it('culls off-screen chunks when zoomed into a corner or completely outside the map', () => {
    const chunks = computeChunkGrid(512, 512);
    const fitted = fitMapToViewport(512, 512, 1024, 768);
    expect(computeVisibleChunkIndices(chunks, fitted, 1024, 768).size).toBe(64);

    const cornerCamera = {
      x: 32 * TILE_WORLD_SIZE,
      y: 32 * TILE_WORLD_SIZE,
      zoom: 2,
      minZoom: 0.05,
      maxZoom: 16,
    };
    const visible = computeVisibleChunkIndices(chunks, cornerCamera, 800, 600);
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(8);
    expect(visible.has(0)).toBe(true);

    const offscreen = {
      x: -5000,
      y: -5000,
      zoom: 2,
      minZoom: 0.05,
      maxZoom: 16,
    };
    expect(computeVisibleChunkIndices(chunks, offscreen, 800, 600).size).toBe(0);
    expect(computeVisibleChunkIndices(chunks, fitted, 0, 600).size).toBe(0);
    expect(computeVisibleChunkIndices(chunks, { ...fitted, zoom: 0 }, 800, 600).size).toBe(0);
  });
});
