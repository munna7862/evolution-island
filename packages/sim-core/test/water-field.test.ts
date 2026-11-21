import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Biome, computeWaterField, isWater, NO_WATER_OFFSET } from '../src/map/index.js';

function bruteForceWaterField(biomes: Uint8Array, width: number, height: number) {
  const size = width * height;
  const dx = new Int16Array(size);
  const dy = new Int16Array(size);

  const waterTiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWater(biomes[y * width + x]!)) {
        waterTiles.push({ x, y });
      }
    }
  }

  if (waterTiles.length === 0) {
    dx.fill(NO_WATER_OFFSET);
    dy.fill(NO_WATER_OFFSET);
    return { dx, dy };
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let bestDist2 = Number.POSITIVE_INFINITY;
      let bestWx = 0;
      let bestWy = 0;

      // Water tiles are pushed in row-major order, so strict `<` breaks ties by smallest row-major index.
      for (const wt of waterTiles) {
        const vx = wt.x - x;
        const vy = wt.y - y;
        const d2 = vx * vx + vy * vy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestWx = wt.x;
          bestWy = wt.y;
        }
      }

      const idx = y * width + x;
      dx[idx] = bestWx - x;
      dy[idx] = bestWy - y;
    }
  }

  return { dx, dy };
}

describe('computeWaterField', () => {
  it('computes exact offsets to a single water tile on a hand-made mini map', () => {
    const width = 5;
    const height = 4;
    const biomes = new Uint8Array(width * height).fill(Biome.Grass);
    // Single water tile at (3, 2)
    biomes[2 * width + 3] = Biome.ShallowWater;

    const field = computeWaterField(biomes, width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        expect(field.dx[idx]).toBe(3 - x);
        expect(field.dy[idx]).toBe(2 - y);
      }
    }
  });

  it('breaks exact Euclidean ties by smallest row-major water tile index', () => {
    const width = 3;
    const height = 3;
    const biomes = new Uint8Array(width * height).fill(Biome.Grass);
    // Four corners are all distance sqrt(2) from center (1, 1).
    // Row-major order: (0,0) has index 0, (2,0) has 2, (0,2) has 6, (2,2) has 8.
    biomes[0] = Biome.DeepWater;
    biomes[2] = Biome.ShallowWater;
    biomes[6] = Biome.ShallowWater;
    biomes[8] = Biome.DeepWater;

    const field = computeWaterField(biomes, width, height);
    const centerIdx = 1 * width + 1;
    expect(field.dx[centerIdx]).toBe(-1);
    expect(field.dy[centerIdx]).toBe(-1);

    // (1, 0) is equidistant from (0, 0) and (2, 0); smallest row-major is (0, 0).
    expect(field.dx[1]).toBe(-1);
    expect(field.dy[1]).toBe(0);

    // (0, 1) is equidistant from (0, 0) and (0, 2); smallest row-major is (0, 0).
    expect(field.dx[width]).toBe(0);
    expect(field.dy[width]).toBe(-1);
  });

  it('breaks asymmetric diagonal ties by smaller row (wy) before smaller column (wx)', () => {
    const width = 3;
    const height = 3;
    const biomes = new Uint8Array(width * height).fill(Biome.Grass);
    // Water only at (2, 0) [index 2] and (0, 2) [index 6].
    // From (1, 1), both are distance sqrt(2); (2, 0) has smaller row-major index (2 < 6).
    biomes[2] = Biome.ShallowWater;
    biomes[6] = Biome.ShallowWater;

    const field = computeWaterField(biomes, width, height);
    const centerIdx = 1 * width + 1;
    expect(field.dx[centerIdx]).toBe(1);
    expect(field.dy[centerIdx]).toBe(-1);
  });

  it('handles 0x0, 1x1, no-water, all-water grids and rejects invalid inputs', () => {
    const empty = computeWaterField(new Uint8Array(0), 0, 0);
    expect(empty.dx).toHaveLength(0);
    expect(empty.dy).toHaveLength(0);

    const oneLand = computeWaterField(new Uint8Array([Biome.Grass]), 1, 1);
    expect(Array.from(oneLand.dx)).toEqual([NO_WATER_OFFSET]);
    expect(Array.from(oneLand.dy)).toEqual([NO_WATER_OFFSET]);

    const oneWater = computeWaterField(new Uint8Array([Biome.ShallowWater]), 1, 1);
    expect(Array.from(oneWater.dx)).toEqual([0]);
    expect(Array.from(oneWater.dy)).toEqual([0]);

    const noWater = new Uint8Array(9).fill(Biome.Sand);
    const emptyField = computeWaterField(noWater, 3, 3);
    expect(Array.from(emptyField.dx)).toEqual(new Array(9).fill(NO_WATER_OFFSET));
    expect(Array.from(emptyField.dy)).toEqual(new Array(9).fill(NO_WATER_OFFSET));

    const allWater = new Uint8Array(9).fill(Biome.DeepWater);
    const fullField = computeWaterField(allWater, 3, 3);
    expect(Array.from(fullField.dx)).toEqual(new Array(9).fill(0));
    expect(Array.from(fullField.dy)).toEqual(new Array(9).fill(0));

    expect(() => computeWaterField(new Uint8Array(4), -1, 4)).toThrow(RangeError);
    expect(() => computeWaterField(new Uint8Array(4), NO_WATER_OFFSET, 1)).toThrow(RangeError);
    expect(() => computeWaterField(new Uint8Array(3), 2, 2)).toThrow(RangeError);
  });

  it('matches an independent brute-force Euclidean oracle across random grids', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 16 }),
        fc.integer({ min: 1, max: 16 }),
        fc.array(
          fc.constantFrom(Biome.Grass, Biome.Mountain, Biome.ShallowWater, Biome.DeepWater),
          {
            minLength: 256,
            maxLength: 256,
          },
        ),
        (width, height, pool) => {
          const biomes = new Uint8Array(width * height);
          for (let i = 0; i < biomes.length; i++) {
            biomes[i] = pool[i]!;
          }

          const actual = computeWaterField(biomes, width, height);
          const expected = bruteForceWaterField(biomes, width, height);

          expect(Array.from(actual.dx)).toEqual(Array.from(expected.dx));
          expect(Array.from(actual.dy)).toEqual(Array.from(expected.dy));
        },
      ),
      { numRuns: 200 },
    );
  });
});
