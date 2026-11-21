import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type MapPresetId, type SimConfig } from '../src/config.js';
import {
  Biome,
  floodFillWalkable,
  generateMap,
  isWalkable,
  isWater,
  unitCirclePoint,
  type WorldMap,
} from '../src/map/index.js';

function isReachableDrinkableWater(
  biomes: Uint8Array,
  reachable: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  const idx = y * width + x;
  const b = biomes[idx]!;
  if (b === Biome.ShallowWater) {
    return reachable[idx] === 1;
  }
  if (b === Biome.DeepWater) {
    return (
      (x > 0 && reachable[idx - 1] === 1) ||
      (x + 1 < width && reachable[idx + 1] === 1) ||
      (y > 0 && reachable[idx - width] === 1) ||
      (y + 1 < height && reachable[idx + width] === 1)
    );
  }
  return false;
}

function assertMapInvariants(map: WorldMap, config: SimConfig): void {
  const preset = config.presets[map.preset];
  const { width, height, biomes, maxFood, food, waterDx, waterDy, spawnZones, hotspots } = map;

  expect(width).toBe(preset.width);
  expect(height).toBe(preset.height);
  expect(biomes).toHaveLength(width * height);
  expect(maxFood).toHaveLength(width * height);
  expect(food).toHaveLength(width * height);
  expect(food).not.toBe(maxFood);
  expect(waterDx).toHaveLength(width * height);
  expect(waterDy).toHaveLength(width * height);
  expect(spawnZones).toHaveLength(preset.tribeCount);
  expect(hotspots).toHaveLength(preset.hotspotCount);

  // 1. Border must be DeepWater.
  for (let x = 0; x < width; x++) {
    expect(biomes[x]).toBe(Biome.DeepWater);
    expect(biomes[(height - 1) * width + x]).toBe(Biome.DeepWater);
  }
  for (let y = 0; y < height; y++) {
    expect(biomes[y * width]).toBe(Biome.DeepWater);
    expect(biomes[y * width + (width - 1)]).toBe(Biome.DeepWater);
  }

  // 2. 4-connected flood-fill from spawn 0 reaches all spawns and hotspots; centers are dry land.
  const first = spawnZones[0]!;
  const reachable = floodFillWalkable(biomes, width, height, first.x, first.y);
  const grassMaxFood = config.map.biomeMaxFood[Biome.Grass];

  for (const zone of spawnZones) {
    const idx = zone.y * width + zone.x;
    expect(reachable[idx]).toBe(1);
    expect(biomes[idx]).not.toBe(Biome.ShallowWater);
    expect(zone.walkableCount).toBeGreaterThanOrEqual(
      config.map.spawnCapacityMultiplier * preset.popCapPerTribe,
    );
  }
  for (const spot of hotspots) {
    const idx = spot.y * width + spot.x;
    expect(reachable[idx]).toBe(1);
    expect(biomes[idx]).not.toBe(Biome.ShallowWater);
    expect(maxFood[idx]).toBeGreaterThan(grassMaxFood);
  }

  // 3. ±15% reachable food and reachable drinkable-water fairness across spawn zones.
  const meanFood =
    spawnZones.reduce((acc, z) => acc + z.foodInFairnessRadius, 0) / spawnZones.length;
  const meanWater =
    spawnZones.reduce((acc, z) => acc + z.waterInFairnessRadius, 0) / spawnZones.length;

  expect(meanFood).toBeGreaterThan(0);
  expect(meanWater).toBeGreaterThan(0);

  const fairR = preset.fairnessRadius;
  const fairRInt = Math.ceil(fairR);
  const fairR2 = fairR * fairR;

  for (const zone of spawnZones) {
    expect(zone.waterInFairnessRadius).toBeGreaterThanOrEqual(config.map.minFairnessWaterTiles);
    expect(Math.abs(zone.foodInFairnessRadius - meanFood) / meanFood).toBeLessThanOrEqual(
      config.map.fairnessTolerance,
    );
    expect(Math.abs(zone.waterInFairnessRadius - meanWater) / meanWater).toBeLessThanOrEqual(
      config.map.fairnessTolerance,
    );

    // Independently verify reachable food and reachable drinkable water tally.
    let expectedFood = 0;
    let expectedWater = 0;
    const minX = Math.max(0, zone.x - fairRInt);
    const maxX = Math.min(width - 1, zone.x + fairRInt);
    const minY = Math.max(0, zone.y - fairRInt);
    const maxY = Math.min(height - 1, zone.y + fairRInt);
    for (let y = minY; y <= maxY; y++) {
      const dy = y - zone.y;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - zone.x;
        if (dx * dx + dy * dy > fairR2) continue;
        const idx = y * width + x;
        if (reachable[idx] === 1) {
          expectedFood += maxFood[idx]!;
        }
        if (isReachableDrinkableWater(biomes, reachable, width, height, x, y)) {
          expectedWater++;
        }
      }
    }
    expect(zone.foodInFairnessRadius).toBe(expectedFood);
    expect(zone.waterInFairnessRadius).toBe(expectedWater);
  }

  // 4. Water field, food invariants, and walkableCount.
  let walkableCount = 0;
  let badWaterTiles = 0;
  let badNonWaterTiles = 0;
  let badFoodInit = 0;
  let badBiomeFood = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const b = biomes[idx]!;
      const mf = maxFood[idx]!;
      if (food[idx] !== mf) {
        badFoodInit++;
      }
      if ((b === Biome.DeepWater || b === Biome.ShallowWater || b === Biome.Mountain) && mf !== 0) {
        badBiomeFood++;
      }
      if ((b === Biome.Sand || b === Biome.Grass || b === Biome.Forest) && mf <= 0) {
        badBiomeFood++;
      }

      if (isWalkable(b)) {
        walkableCount++;
      }
      if (isWater(b)) {
        if (waterDx[idx] !== 0 || waterDy[idx] !== 0) {
          badWaterTiles++;
        }
      } else {
        const tx = x + waterDx[idx]!;
        const ty = y + waterDy[idx]!;
        if (tx < 0 || tx >= width || ty < 0 || ty >= height || !isWater(biomes[ty * width + tx]!)) {
          badNonWaterTiles++;
        }
      }
    }
  }
  expect(badFoodInit).toBe(0);
  expect(badBiomeFood).toBe(0);
  expect(badWaterTiles).toBe(0);
  expect(badNonWaterTiles).toBe(0);
  expect(map.walkableCount).toBe(walkableCount);

  // 5. Biome diversity (including mountains on non-tiny maps).
  const seen = new Set<number>(biomes);
  expect(seen.has(Biome.DeepWater)).toBe(true);
  expect(seen.has(Biome.ShallowWater)).toBe(true);
  expect(seen.has(Biome.Sand)).toBe(true);
  expect(seen.has(Biome.Grass)).toBe(true);
  expect(seen.has(Biome.Forest)).toBe(true);
  if (map.preset !== 'small') {
    expect(seen.has(Biome.Mountain)).toBe(true);
  }
}

describe('unitCirclePoint', () => {
  it('matches Math.cos and Math.sin within 1e-12 without using trig intrinsics', () => {
    for (let i = -32; i <= 64; i++) {
      const turn = i / 29;
      const [cx, cy] = unitCirclePoint(turn);
      const angle = turn * 2 * Math.PI;
      expect(Math.abs(cx - Math.cos(angle))).toBeLessThan(1e-12);
      expect(Math.abs(cy - Math.sin(angle))).toBeLessThan(1e-12);
    }
  });

  it('produces canonical zeros without -0 at cardinal turns and large angles', () => {
    for (const turn of [0, 0.25, 0.5, 0.75, -0.25, 10.25]) {
      const [x, y] = unitCirclePoint(turn);
      expect(Object.is(x, -0)).toBe(false);
      expect(Object.is(y, -0)).toBe(false);
    }
    expect(unitCirclePoint(0)).toEqual([1, 0]);
    expect(unitCirclePoint(0.25)).toEqual([0, 1]);
    expect(unitCirclePoint(0.5)).toEqual([-1, 0]);
    expect(unitCirclePoint(0.75)).toEqual([0, -1]);
  });
});

describe('floodFillWalkable', () => {
  it('uses 4-connected reachability and handles out-of-bounds or unwalkable starts', () => {
    // 3x3 map with a diagonal mountain wall separating (0,0) from (2,2) across (1,0)/(0,1)?
    // Actually diagonal land at (0,0) and (1,1) separated by mountains at (1,0) and (0,1).
    const biomes = new Uint8Array([
      Biome.Grass,
      Biome.Mountain,
      Biome.Grass,
      Biome.Mountain,
      Biome.Grass,
      Biome.Grass,
      Biome.Grass,
      Biome.Grass,
      Biome.Grass,
    ]);

    const fromCorner = floodFillWalkable(biomes, 3, 3, 0, 0);
    expect(Array.from(fromCorner)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);

    const fromOutOfBounds = floodFillWalkable(biomes, 3, 3, -1, 0);
    expect(Array.from(fromOutOfBounds)).toEqual(new Array(9).fill(0));

    const fromMountain = floodFillWalkable(biomes, 3, 3, 1, 0);
    expect(Array.from(fromMountain)).toEqual(new Array(9).fill(0));
  });
});

describe('generateMap', () => {
  it('produces identical hashes and buffers for the same seed and different hashes for different seeds', () => {
    const a = generateMap({ preset: 'small', seed: 'determinism-seed' });
    const b = generateMap({ preset: 'small', seed: 'determinism-seed' });
    const c = generateMap({ preset: 'small', seed: 'determinism-seed-2' });

    expect(a.hash).toBe(b.hash);
    expect(a.attempt).toBe(b.attempt);
    expect(Array.from(a.biomes)).toEqual(Array.from(b.biomes));
    expect(Array.from(a.maxFood)).toEqual(Array.from(b.maxFood));
    expect(Array.from(a.waterDx)).toEqual(Array.from(b.waterDx));
    expect(Array.from(a.waterDy)).toEqual(Array.from(b.waterDy));
    expect(a.hash).not.toBe(c.hash);
  });

  it.each<{ preset: MapPresetId; seeds: number[] }>([
    { preset: 'small', seeds: Array.from({ length: 20 }, (_, i) => i + 1) },
    { preset: 'medium', seeds: Array.from({ length: 15 }, (_, i) => i + 100) },
    { preset: 'large', seeds: Array.from({ length: 6 }, (_, i) => i + 1000) },
    { preset: 'huge', seeds: Array.from({ length: 3 }, (_, i) => i + 10_000) },
  ])(
    'satisfies connectivity, capacity, water field and ±15% fairness on $preset across seeds',
    ({ preset, seeds }) => {
      for (const seed of seeds) {
        const map = generateMap({ preset, seed });
        assertMapInvariants(map, DEFAULT_CONFIG);
      }
    },
    30_000,
  );

  it('supports hotspotCount = 0 and spawnZoneRadius > fairnessRadius without clipping capacity', () => {
    const customConfig: SimConfig = {
      ...DEFAULT_CONFIG,
      presets: {
        ...DEFAULT_CONFIG.presets,
        small: {
          ...DEFAULT_CONFIG.presets.small,
          hotspotCount: 0,
          spawnZoneRadius: 10,
          fairnessRadius: 7,
        },
      },
    };
    const map = generateMap({ preset: 'small', seed: 11, config: customConfig });
    expect(map.hotspots).toHaveLength(0);
    assertMapInvariants(map, customConfig);
  });

  it('retries deterministically when strict tolerance rejects early attempts and throws when exhausted', () => {
    const strictConfig: SimConfig = {
      ...DEFAULT_CONFIG,
      map: {
        ...DEFAULT_CONFIG.map,
        fairnessTolerance: 0.03,
        maxGenerationAttempts: 64,
      },
    };

    const first = generateMap({ preset: 'small', seed: 7, config: strictConfig });
    const second = generateMap({ preset: 'small', seed: 7, config: strictConfig });
    expect(first.hash).toBe(second.hash);
    expect(first.attempt).toBe(second.attempt);
    assertMapInvariants(first, strictConfig);

    const impossibleConfig: SimConfig = {
      ...DEFAULT_CONFIG,
      map: {
        ...DEFAULT_CONFIG.map,
        fairnessTolerance: -0.01,
        maxGenerationAttempts: 3,
      },
    };
    expect(() => generateMap({ preset: 'small', seed: 7, config: impossibleConfig })).toThrow(
      /Failed to generate small map/,
    );
  });
});
