import { isWater, type WaterField } from './types.js';

/**
 * Sentinel offset stored in waterDx / waterDy when a map has zero water tiles.
 */
export const NO_WATER_OFFSET = 32767;

const INF = 1e12;

/**
 * Computes the exact nearest-water offset (dx, dy) for every tile in O(W * H) time
 * using a two-pass separable 2D Euclidean Distance Transform (Felzenszwalb & Huttenlocher).
 *
 * Ties in exact squared Euclidean distance are broken deterministically by smallest
 * row-major water tile index (wy * width + wx). Water tiles always get (0, 0).
 */
export function computeWaterField(biomes: Uint8Array, width: number, height: number): WaterField {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0 ||
    width >= NO_WATER_OFFSET ||
    height >= NO_WATER_OFFSET
  ) {
    throw new RangeError(
      `computeWaterField dimensions must be integers in [0, ${NO_WATER_OFFSET}), received ${width}x${height}`,
    );
  }
  const size = width * height;
  if (biomes.length < size) {
    throw new RangeError(
      `computeWaterField biomes length (${biomes.length}) is smaller than ${width}x${height} (${size})`,
    );
  }
  const dx = new Int16Array(size);
  const dy = new Int16Array(size);

  if (size === 0) {
    return { dx, dy };
  }

  // Pass 1: horizontal 1D nearest water in each row, breaking ties by smaller wx.
  const rowNearestX = new Int32Array(size);
  const rowDx2 = new Float64Array(size);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let lastWaterX = -1;

    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (isWater(biomes[idx]!)) {
        lastWaterX = x;
      }
      if (lastWaterX >= 0) {
        const d = x - lastWaterX;
        rowNearestX[idx] = lastWaterX;
        rowDx2[idx] = d * d;
      } else {
        rowNearestX[idx] = -1;
        rowDx2[idx] = INF;
      }
    }

    lastWaterX = -1;
    for (let x = width - 1; x >= 0; x--) {
      const idx = rowOffset + x;
      if (isWater(biomes[idx]!)) {
        lastWaterX = x;
      }
      if (lastWaterX >= 0) {
        const d = lastWaterX - x;
        const d2 = d * d;
        // Strict `<` keeps the smaller wx from the left-to-right pass on exact ties.
        if (d2 < rowDx2[idx]!) {
          rowNearestX[idx] = lastWaterX;
          rowDx2[idx] = d2;
        }
      }
    }
  }

  // Pass 2: vertical 1D lower envelope of parabolas per column.
  const v = new Int32Array(height);
  const z = new Float64Array(height + 1);
  const validRows = new Int32Array(height);
  let hasAnyWater = false;

  for (let x = 0; x < width; x++) {
    let validCount = 0;
    for (let y = 0; y < height; y++) {
      if (rowDx2[y * width + x]! < INF) {
        validRows[validCount] = y;
        validCount++;
      }
    }

    if (validCount === 0) {
      continue;
    }
    hasAnyWater = true;

    let k = 0;
    v[0] = validRows[0]!;
    z[0] = -INF;
    z[1] = INF;

    for (let i = 1; i < validCount; i++) {
      const q = validRows[i]!;
      const fq = rowDx2[q * width + x]!;

      let r = v[k]!;
      let fr = rowDx2[r * width + x]!;
      let s = (fq + q * q - (fr + r * r)) / (2 * (q - r));

      while (s <= z[k]!) {
        k--;
        r = v[k]!;
        fr = rowDx2[r * width + x]!;
        s = (fq + q * q - (fr + r * r)) / (2 * (q - r));
      }

      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }

    const hullLen = k + 1;
    let queryIdx = 0;
    for (let y = 0; y < height; y++) {
      // Strict `<` ensures exact ties at z[queryIdx + 1] === y choose the smaller wy.
      while (queryIdx + 1 < hullLen && z[queryIdx + 1]! < y) {
        queryIdx++;
      }
      const wy = v[queryIdx]!;
      const wx = rowNearestX[wy * width + x]!;
      const outIdx = y * width + x;
      dx[outIdx] = wx - x;
      dy[outIdx] = wy - y;
    }
  }

  if (!hasAnyWater) {
    dx.fill(NO_WATER_OFFSET);
    dy.fill(NO_WATER_OFFSET);
  }

  return { dx, dy };
}
