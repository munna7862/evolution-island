import { DEFAULT_CONFIG, type SimConfig, type WorldMap } from '@evolution-island/sim-core';
import { TILE_WORLD_SIZE, type CameraState } from './camera.js';
import { tileColorRgb } from './palette.js';

export const CHUNK_SIZE = 64;

export interface ChunkDescriptor {
  readonly id: number;
  readonly cx: number;
  readonly cy: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tilesW: number;
  readonly tilesH: number;
}

export function computeChunkGrid(
  width: number,
  height: number,
  chunkSize = CHUNK_SIZE,
): readonly ChunkDescriptor[] {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(chunkSize) ||
    width <= 0 ||
    height <= 0 ||
    chunkSize <= 0
  ) {
    return [];
  }

  const chunks: ChunkDescriptor[] = [];
  const cols = Math.ceil(width / chunkSize);
  const rows = Math.ceil(height / chunkSize);
  let id = 0;

  for (let cy = 0; cy < rows; cy++) {
    const tileY = cy * chunkSize;
    const tilesH = Math.min(chunkSize, height - tileY);
    for (let cx = 0; cx < cols; cx++) {
      const tileX = cx * chunkSize;
      const tilesW = Math.min(chunkSize, width - tileX);
      chunks.push({ id, cx, cy, tileX, tileY, tilesW, tilesH });
      id++;
    }
  }

  return chunks;
}

export function buildChunkPixels(
  map: WorldMap,
  chunk: ChunkDescriptor,
  config: SimConfig = DEFAULT_CONFIG,
): Uint8Array {
  const pixels = new Uint8Array(chunk.tilesW * chunk.tilesH * 4);

  for (let ly = 0; ly < chunk.tilesH; ly++) {
    const mapY = chunk.tileY + ly;
    const mapRowOffset = mapY * map.width;
    const pixelRowOffset = ly * chunk.tilesW;

    for (let lx = 0; lx < chunk.tilesW; lx++) {
      const mapIdx = mapRowOffset + chunk.tileX + lx;
      const [r, g, b] = tileColorRgb(map.biomes[mapIdx]!, map.maxFood[mapIdx]!, config.map);
      const out = (pixelRowOffset + lx) * 4;
      pixels[out] = r;
      pixels[out + 1] = g;
      pixels[out + 2] = b;
      pixels[out + 3] = 255;
    }
  }

  return pixels;
}

export function computeVisibleChunkIndices(
  chunks: readonly ChunkDescriptor[],
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  tileWorldSize = TILE_WORLD_SIZE,
): Set<number> {
  const visible = new Set<number>();
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(camera.zoom) ||
    !Number.isFinite(tileWorldSize) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    camera.zoom <= 0 ||
    tileWorldSize <= 0
  ) {
    return visible;
  }

  const halfWorldW = (viewportWidth * 0.5) / camera.zoom;
  const halfWorldH = (viewportHeight * 0.5) / camera.zoom;
  const viewMinX = camera.x - halfWorldW;
  const viewMaxX = camera.x + halfWorldW;
  const viewMinY = camera.y - halfWorldH;
  const viewMaxY = camera.y + halfWorldH;

  for (const chunk of chunks) {
    const minX = chunk.tileX * tileWorldSize;
    const maxX = (chunk.tileX + chunk.tilesW) * tileWorldSize;
    const minY = chunk.tileY * tileWorldSize;
    const maxY = (chunk.tileY + chunk.tilesH) * tileWorldSize;

    if (maxX >= viewMinX && minX <= viewMaxX && maxY >= viewMinY && minY <= viewMaxY) {
      visible.add(chunk.id);
    }
  }

  return visible;
}
