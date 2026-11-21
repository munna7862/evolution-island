import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Biome,
  computeWaterField,
  createWorld,
  DEFAULT_CONFIG,
  hidesCreatures,
  isWater,
  NO_WATER_OFFSET,
  readSensors,
  SENSOR_COUNT,
  SensorIndex,
  type Creature,
  type World,
  type WorldMap,
} from '../src/index.js';

function makeMiniMap(biomesGrid: Biome[][], foodGrid?: number[][]): WorldMap {
  const height = biomesGrid.length;
  const width = biomesGrid[0]!.length;
  const size = width * height;
  const biomes = new Uint8Array(size);
  const maxFood = new Float32Array(size);
  const food = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      biomes[idx] = biomesGrid[y]![x]!;
      const fv = foodGrid?.[y]?.[x] ?? 0;
      maxFood[idx] = fv;
      food[idx] = fv;
    }
  }

  const wf = computeWaterField(biomes, width, height);
  return {
    width,
    height,
    preset: 'small',
    seed: 'sensor-mini',
    attempt: 0,
    walkableCount: size,
    biomes,
    maxFood,
    food,
    waterDx: wf.dx,
    waterDy: wf.dy,
    spawnZones: [],
    hotspots: [],
    hash: '0000000000000002',
  };
}

function bruteForceSensors(world: World, creature: Creature): number[] {
  const { width, height, biomes, food } = world.map;
  const { creature: cCfg, sensor: sCfg } = world.config;
  const vr = sCfg.visionRadius;
  const vr2 = vr * vr;
  const forestVr = vr * sCfg.forestVisionMultiplier;
  const forestVr2 = forestVr * forestVr;
  const cx = creature.x;
  const cy = creature.y;
  const selfIdx = cy * width + cx;

  // Nearest food brute force: other tiles only, food >= minVisibleFood (Euclidean, tie by dy then dx).
  let bestFoodD2 = vr2 + 1;
  let bestFoodDx = 0;
  let bestFoodDy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileFood = food[y * width + x]!;
      if (tileFood <= 0 || tileFood < sCfg.minVisibleFood) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx === 0 && dy === 0) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 <= vr2) {
        if (
          d2 < bestFoodD2 ||
          (d2 === bestFoodD2 && (dy < bestFoodDy || (dy === bestFoodDy && dx < bestFoodDx)))
        ) {
          bestFoodD2 = d2;
          bestFoodDx = dx;
          bestFoodDy = dy;
        }
      }
    }
  }

  // Nearest water brute force (Euclidean, tie by smallest wy * width + wx, limited to vr).
  let bestWaterD2 = Number.POSITIVE_INFINITY;
  let bestWaterDx = 0;
  let bestWaterDy = 0;
  let foundWater = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isWater(biomes[y * width + x]!)) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestWaterD2) {
        bestWaterD2 = d2;
        bestWaterDx = dx;
        bestWaterDy = dy;
        foundWater = true;
      }
    }
  }
  if (!foundWater || bestWaterD2 > vr2) {
    bestWaterDx = 0;
    bestWaterDy = 0;
  }

  // Allies & enemies brute force.
  let allyCount = 0;
  let enemyCount = 0;
  let bestAllyD2 = vr2 + 1;
  let bestAllyId = Number.POSITIVE_INFINITY;
  let bestAllyDx = 0;
  let bestAllyDy = 0;
  let bestEnemyD2 = vr2 + 1;
  let bestEnemyId = Number.POSITIVE_INFINITY;
  let bestEnemyDx = 0;
  let bestEnemyDy = 0;
  let enemyAdjacent = 0;

  for (const other of world.creatures) {
    if (!other.alive || other.id === creature.id) continue;
    const dx = other.x - cx;
    const dy = other.y - cy;
    const d2 = dx * dx + dy * dy;
    if (other.tribeId !== creature.tribeId && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      enemyAdjacent = 1;
    }
    const limit2 = hidesCreatures(biomes[other.y * width + other.x]!) ? forestVr2 : vr2;
    if (d2 > limit2) continue;

    if (other.tribeId === creature.tribeId) {
      allyCount++;
      if (d2 < bestAllyD2 || (d2 === bestAllyD2 && other.id < bestAllyId)) {
        bestAllyD2 = d2;
        bestAllyId = other.id;
        bestAllyDx = dx;
        bestAllyDy = dy;
      }
    } else {
      enemyCount++;
      if (d2 < bestEnemyD2 || (d2 === bestEnemyD2 && other.id < bestEnemyId)) {
        bestEnemyD2 = d2;
        bestEnemyId = other.id;
        bestEnemyDx = dx;
        bestEnemyDy = dy;
      }
    }
  }

  const waterReachable =
    isWater(biomes[selfIdx]!) ||
    (cx > 0 && isWater(biomes[selfIdx - 1]!)) ||
    (cx + 1 < width && isWater(biomes[selfIdx + 1]!)) ||
    (cy > 0 && isWater(biomes[selfIdx - width]!)) ||
    (cy + 1 < height && isWater(biomes[selfIdx + width]!))
      ? 1
      : 0;

  return [
    Math.fround(creature.energy / cCfg.maxEnergy),
    Math.fround(creature.hydration / cCfg.maxHydration),
    Math.fround(creature.health / cCfg.maxHealth),
    Math.fround(bestFoodDx / vr),
    Math.fround(bestFoodDy / vr),
    Math.fround(bestWaterDx / vr),
    Math.fround(bestWaterDy / vr),
    Math.fround(bestAllyDx / vr),
    Math.fround(bestAllyDy / vr),
    Math.fround(bestEnemyDx / vr),
    Math.fround(bestEnemyDy / vr),
    Math.fround(Math.min(1, enemyCount / sCfg.countNormalization)),
    Math.fround(Math.min(1, allyCount / sCfg.countNormalization)),
    Math.fround(Math.min(1, food[selfIdx]! / sCfg.foodNormalization)),
    waterReachable,
    hidesCreatures(biomes[selfIdx]!) ? 1 : 0,
    enemyAdjacent,
    1,
  ];
}

describe('readSensors (18 inputs)', () => {
  it('reads own stats, food, water, flags, and bias on a hand-made mini map', () => {
    const biomes = Array.from({ length: 12 }, () => new Array<Biome>(12).fill(Biome.Grass));
    biomes[2]![5] = Biome.ShallowWater; // Water at (5, 2) -> dx=0, dy=-3 from (5,5)
    biomes[5]![5] = Biome.Forest; // Observer stands in Forest
    const foodGrid = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
    foodGrid[5]![5] = 80; // Own tile is excluded from the food direction -> no other food -> (0, 0)

    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
    });
    const c = world.spawnCreature(0, 5, 5)!;
    c.energy = 40;
    c.hydration = 75;
    c.health = 50;

    const s = readSensors(world, c);
    expect(s).toHaveLength(SENSOR_COUNT);
    expect(s[SensorIndex.ENERGY]).toBeCloseTo(0.4, 5);
    expect(s[SensorIndex.HYDRATION]).toBeCloseTo(0.75, 5);
    expect(s[SensorIndex.HEALTH]).toBeCloseTo(0.5, 5);
    expect(s[SensorIndex.FOOD_DX]).toBe(0);
    expect(s[SensorIndex.FOOD_DY]).toBe(0);
    expect(s[SensorIndex.WATER_DX]).toBe(0);
    expect(s[SensorIndex.WATER_DY]).toBeCloseTo(-3 / 8, 5);
    expect(s[SensorIndex.CURRENT_TILE_FOOD]).toBeCloseTo(
      80 / DEFAULT_CONFIG.sensor.foodNormalization,
      5,
    );
    expect(s[SensorIndex.WATER_REACHABLE]).toBe(0);
    expect(s[SensorIndex.IN_FOREST]).toBe(1);
    expect(s[SensorIndex.ENEMY_ADJACENT]).toBe(0);
    expect(s[SensorIndex.BIAS]).toBe(1);
  });

  it('reports (0, 0) for food/water beyond visionRadius or when no water exists', () => {
    const biomes = Array.from({ length: 12 }, () => new Array<Biome>(12).fill(Biome.Sand));
    const foodGrid = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
    foodGrid[11]![11] = 15; // distance from (0,0) = sqrt(242) > 8
    const map = makeMiniMap(biomes, foodGrid);
    expect(map.waterDx[0]).toBe(NO_WATER_OFFSET);

    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 0, 0)!;
    const s = readSensors(world, c);

    expect(s[SensorIndex.FOOD_DX]).toBe(0);
    expect(s[SensorIndex.FOOD_DY]).toBe(0);
    expect(s[SensorIndex.WATER_DX]).toBe(0);
    expect(s[SensorIndex.WATER_DY]).toBe(0);
    expect(s[SensorIndex.CURRENT_TILE_FOOD]).toBe(0);
  });

  it('enforces forest hiding (visionRadius / 2), lowest-id tie-breaks, counts, and ENEMY_ADJACENT', () => {
    const biomes = Array.from({ length: 12 }, () => new Array<Biome>(12).fill(Biome.Grass));
    biomes[5]![10] = Biome.Forest; // (10, 5) is distance 5 from (5, 5) -> hidden (> 8/2 = 4)
    biomes[1]![5] = Biome.Forest; // (5, 1) is distance 4 from (5, 5) -> visible (<= 4)
    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes),
      populate: false,
    });

    const observer = world.spawnCreature(0, 5, 5)!; // id 0
    // Enemy hidden in forest at distance 5:
    world.spawnCreature(1, 10, 5); // id 1
    // Enemy visible in forest at distance 4:
    world.spawnCreature(1, 5, 1); // id 2
    // Two allies equidistant (distance 2) on open grass -> tie-break by lowest id (3 vs 4):
    world.spawnCreature(0, 7, 5); // id 3 (dx=+2, dy=0)
    world.spawnCreature(0, 3, 5); // id 4 (dx=-2, dy=0)
    // Dead enemy at (6, 5) must be ignored for ENEMY_ADJACENT and counts:
    const deadEnemy = world.spawnCreature(1, 6, 5)!; // id 5
    deadEnemy.alive = false;

    let s = readSensors(world, observer);
    expect(s[SensorIndex.ENEMY_DX]).toBe(0);
    expect(s[SensorIndex.ENEMY_DY]).toBeCloseTo(-4 / 8, 5);
    expect(s[SensorIndex.ENEMIES_IN_VISION]).toBeCloseTo(1 / 5, 5);
    expect(s[SensorIndex.ALLY_DX]).toBeCloseTo(2 / 8, 5);
    expect(s[SensorIndex.ALLY_DY]).toBe(0);
    expect(s[SensorIndex.ALLIES_IN_VISION]).toBeCloseTo(2 / 5, 5);
    expect(s[SensorIndex.ENEMY_ADJACENT]).toBe(0);

    // Living enemy diagonally adjacent at (4, 4) -> ENEMY_ADJACENT = 1.
    world.spawnCreature(1, 4, 4); // id 6
    s = readSensors(world, observer);
    expect(s[SensorIndex.ENEMY_ADJACENT]).toBe(1);
    expect(s[SensorIndex.ENEMY_DX]).toBeCloseTo(-1 / 8, 5);
    expect(s[SensorIndex.ENEMY_DY]).toBeCloseTo(-1 / 8, 5);
  });

  it('writes into a reusable output buffer and rejects undersized buffers', () => {
    const world = createWorld({ preset: 'small', seed: 42 });
    const c = world.creatures[0]!;
    const out = new Float32Array(SENSOR_COUNT);
    const returned = readSensors(world, c, out);
    expect(returned).toBe(out);
    expect(out[SensorIndex.BIAS]).toBe(1);

    expect(() => readSensors(world, c, new Float32Array(SENSOR_COUNT - 1))).toThrow(RangeError);
  });

  it('finds off-tile nearest food with (dy, dx) tie-break and respects Euclidean circle boundary', () => {
    const biomes = Array.from({ length: 20 }, () => new Array<Biome>(20).fill(Biome.Grass));
    const foodGrid = Array.from({ length: 20 }, () => new Array<number>(20).fill(0));
    // Equidistant d2 = 2 tiles: (11, 9) -> (dx=+1, dy=-1) and (9, 11) -> (dx=-1, dy=+1).
    foodGrid[11]![9] = 40;
    foodGrid[9]![11] = 40;

    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
    });
    const c = world.spawnCreature(0, 10, 10)!;
    const sTie = readSensors(world, c);
    // Smallest dy wins: dy = -1, dx = +1.
    expect(sTie[SensorIndex.FOOD_DX]).toBeCloseTo(1 / 8, 5);
    expect(sTie[SensorIndex.FOOD_DY]).toBeCloseTo(-1 / 8, 5);

    // Clear close food; place one outside circle at (18, 11) -> d2 = 65 > 64 and one inside at (18, 10) -> d2 = 64.
    world.map.food[9 * 20 + 11] = 0;
    world.map.food[11 * 20 + 9] = 0;
    world.map.food[11 * 20 + 18] = 50;
    const sOut = readSensors(world, c);
    expect(sOut[SensorIndex.FOOD_DX]).toBe(0);
    expect(sOut[SensorIndex.FOOD_DY]).toBe(0);

    world.map.food[10 * 20 + 18] = 50;
    const sEdge = readSensors(world, c);
    expect(sEdge[SensorIndex.FOOD_DX]).toBe(1);
    expect(sEdge[SensorIndex.FOOD_DY]).toBe(0);
  });

  it('food direction skips the own tile and tiles below minVisibleFood', () => {
    const biomes = Array.from({ length: 20 }, () => new Array<Biome>(20).fill(Biome.Grass));
    const foodGrid = Array.from({ length: 20 }, () => new Array<number>(20).fill(0));
    const minFood = DEFAULT_CONFIG.sensor.minVisibleFood;
    foodGrid[10]![10] = 100; // own tile: rich, but reported by CURRENT_TILE_FOOD only
    foodGrid[10]![11] = minFood - 0.5; // adjacent, just below the threshold
    foodGrid[10]![9] = 0.15; // adjacent, freshly grazed and regrowing
    foodGrid[10]![13] = minFood; // 3 tiles east, exactly one bite

    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
    });
    const c = world.spawnCreature(0, 10, 10)!;
    const s = readSensors(world, c);
    expect(s[SensorIndex.FOOD_DX]).toBeCloseTo(3 / 8, 5);
    expect(s[SensorIndex.FOOD_DY]).toBe(0);
    expect(s[SensorIndex.CURRENT_TILE_FOOD]).toBeCloseTo(
      100 / DEFAULT_CONFIG.sensor.foodNormalization,
      5,
    );

    // Nothing worthwhile left in sight -> (0, 0), even though the own and adjacent tiles hold food.
    world.map.food[10 * 20 + 13] = minFood - 1;
    const sNone = readSensors(world, c);
    expect(sNone[SensorIndex.FOOD_DX]).toBe(0);
    expect(sNone[SensorIndex.FOOD_DY]).toBe(0);

    // minVisibleFood = 0 falls back to "any food > 0" (own tile still excluded): the regrowing
    // west neighbour wins the d² = 1 tie (dy, then dx ascending).
    const anyFoodWorld = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
      config: { ...DEFAULT_CONFIG, sensor: { ...DEFAULT_CONFIG.sensor, minVisibleFood: 0 } },
    });
    const c2 = anyFoodWorld.spawnCreature(0, 10, 10)!;
    const sAny = readSensors(anyFoodWorld, c2);
    expect(sAny[SensorIndex.FOOD_DX]).toBeCloseTo(-1 / 8, 5);
    expect(sAny[SensorIndex.FOOD_DY]).toBe(0);
  });

  it('returns (0, 0) for water beyond visionRadius even when water exists on the map', () => {
    const biomes = Array.from({ length: 16 }, () => new Array<Biome>(16).fill(Biome.Grass));
    biomes[15]![15] = Biome.ShallowWater; // distance from (0, 0) is sqrt(450) > 8
    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes),
      populate: false,
    });
    expect(world.map.waterDx[0]).toBe(15);
    expect(world.map.waterDy[0]).toBe(15);

    const c = world.spawnCreature(0, 0, 0)!;
    const s = readSensors(world, c);
    expect(s[SensorIndex.WATER_DX]).toBe(0);
    expect(s[SensorIndex.WATER_DY]).toBe(0);
  });

  it('detects WATER_REACHABLE on/4-adjacent to ShallowWater or DeepWater, not diagonally', () => {
    const biomes = Array.from({ length: 12 }, () => new Array<Biome>(12).fill(Biome.Grass));
    biomes[5]![5] = Biome.ShallowWater;
    biomes[8]![8] = Biome.DeepWater;

    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes),
      populate: false,
    });
    const onShallow = world.spawnCreature(0, 5, 5)!;
    const adjDeep = world.spawnCreature(0, 8, 7)!;
    const diagShallow = world.spawnCreature(0, 4, 4)!;

    expect(readSensors(world, onShallow)[SensorIndex.WATER_REACHABLE]).toBe(1);
    expect(readSensors(world, adjDeep)[SensorIndex.WATER_REACHABLE]).toBe(1);
    expect(readSensors(world, diagShallow)[SensorIndex.WATER_REACHABLE]).toBe(0);
  });

  it('clamps counts and tile food at 1.0, handles zero normalizers, and breaks enemy ties by lowest id', () => {
    const biomes = Array.from({ length: 20 }, () => new Array<Biome>(20).fill(Biome.Grass));
    const foodGrid = Array.from({ length: 20 }, () => new Array<number>(20).fill(0));
    foodGrid[10]![10] = 500; // > foodNormalization (160)

    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
    });
    const observer = world.spawnCreature(0, 10, 10)!; // id 0
    // 6 allies (> countNormalization = 5)
    for (let i = 0; i < 6; i++) {
      world.spawnCreature(0, 10 + i + 1, 10);
    }
    // 6 enemies; first two equidistant at dist 2 -> id 7 beats id 8 despite order.
    world.spawnCreature(1, 8, 10); // id 7 (dx=-2, dy=0)
    world.spawnCreature(1, 10, 12); // id 8 (dx=0, dy=+2)
    for (let i = 0; i < 4; i++) {
      world.spawnCreature(1, 10, 10 - (i + 3));
    }

    const s = readSensors(world, observer);
    expect(s[SensorIndex.ALLIES_IN_VISION]).toBe(1);
    expect(s[SensorIndex.ENEMIES_IN_VISION]).toBe(1);
    expect(s[SensorIndex.CURRENT_TILE_FOOD]).toBe(1);
    expect(s[SensorIndex.ENEMY_DX]).toBeCloseTo(-2 / 8, 5);
    expect(s[SensorIndex.ENEMY_DY]).toBe(0);
    expect(s[SensorIndex.IN_FOREST]).toBe(0);

    // Zero normalizers clamp positive values cleanly to 1.
    const zeroNormWorld = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
      config: {
        ...DEFAULT_CONFIG,
        sensor: {
          ...DEFAULT_CONFIG.sensor,
          countNormalization: 0,
          foodNormalization: 0,
        },
      },
    });
    const zObs = zeroNormWorld.spawnCreature(0, 10, 10)!;
    zeroNormWorld.spawnCreature(1, 11, 10);
    const zs = readSensors(zeroNormWorld, zObs);
    expect(zs[SensorIndex.ENEMIES_IN_VISION]).toBe(1);
    expect(zs[SensorIndex.ALLIES_IN_VISION]).toBe(0);
    expect(zs[SensorIndex.CURRENT_TILE_FOOD]).toBe(1);
  });

  it('allows an observer in forest to see an enemy on open terrain up to full visionRadius', () => {
    const biomes = Array.from({ length: 16 }, () => new Array<Biome>(16).fill(Biome.Grass));
    biomes[5]![5] = Biome.Forest; // observer is in forest
    // enemy at (12, 5) is on Grass at distance 7 (between forestVision 4 and visionRadius 8)
    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes),
      populate: false,
    });
    const observer = world.spawnCreature(0, 5, 5)!;
    world.spawnCreature(1, 12, 5);

    const s = readSensors(world, observer);
    expect(s[SensorIndex.IN_FOREST]).toBe(1);
    expect(s[SensorIndex.ENEMIES_IN_VISION]).toBeCloseTo(1 / 5, 5);
    expect(s[SensorIndex.ENEMY_DX]).toBeCloseTo(7 / 8, 5);
    expect(s[SensorIndex.ENEMY_DY]).toBe(0);
  });

  it('handles visionRadius === 0, NaN safely, and rejects visionRadius >= 32768', () => {
    const biomes = Array.from({ length: 12 }, () => new Array<Biome>(12).fill(Biome.Grass));
    const foodGrid = Array.from({ length: 12 }, () => new Array<number>(12).fill(10));
    biomes[5]![6] = Biome.ShallowWater;

    // visionRadius === 0 returns 0 for vision offsets/counts while preserving local tile/adjacent flags.
    const zeroVrWorld = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
      config: {
        ...DEFAULT_CONFIG,
        sensor: { ...DEFAULT_CONFIG.sensor, visionRadius: 0 },
      },
    });
    const obs = zeroVrWorld.spawnCreature(0, 5, 5)!;
    zeroVrWorld.spawnCreature(1, 5, 4); // adjacent enemy
    const sZero = readSensors(zeroVrWorld, obs);
    for (let i = 0; i < SENSOR_COUNT; i++) {
      expect(Number.isFinite(sZero[i])).toBe(true);
    }
    expect(sZero[SensorIndex.FOOD_DX]).toBe(0);
    expect(sZero[SensorIndex.FOOD_DY]).toBe(0);
    expect(sZero[SensorIndex.WATER_DX]).toBe(0);
    expect(sZero[SensorIndex.WATER_DY]).toBe(0);
    expect(sZero[SensorIndex.ENEMIES_IN_VISION]).toBe(0);
    expect(sZero[SensorIndex.WATER_REACHABLE]).toBe(1);
    expect(sZero[SensorIndex.ENEMY_ADJACENT]).toBe(1);
    expect(sZero[SensorIndex.IN_FOREST]).toBe(0);

    // createWorld rejects NaN visionRadius via SpatialGrid validation.
    expect(() =>
      createWorld({
        preset: 'small',
        seed: 1,
        map: makeMiniMap(biomes, foodGrid),
        populate: false,
        config: {
          ...DEFAULT_CONFIG,
          sensor: { ...DEFAULT_CONFIG.sensor, visionRadius: Number.NaN },
        },
      }),
    ).toThrow(RangeError);

    // Runtime NaN in sensor config produces finite zero outputs rather than NaN poison.
    (zeroVrWorld.config.sensor as { visionRadius: number }).visionRadius = Number.NaN;
    const sNan = readSensors(zeroVrWorld, obs);
    for (let i = 0; i < SENSOR_COUNT; i++) {
      expect(Number.isFinite(sNan[i])).toBe(true);
    }
    expect(sNan[SensorIndex.ENEMIES_IN_VISION]).toBe(0);

    const hugeVrWorld = createWorld({
      preset: 'small',
      seed: 1,
      map: makeMiniMap(biomes, foodGrid),
      populate: false,
      config: {
        ...DEFAULT_CONFIG,
        sensor: { ...DEFAULT_CONFIG.sensor, visionRadius: 32768 },
      },
    });
    const c = hugeVrWorld.spawnCreature(0, 5, 5)!;
    expect(() => readSensors(hugeVrWorld, c)).toThrow(RangeError);
  });

  it('integrates with World.tick() and lazily rebuilds dirty SpatialGrid via ensureGrid()', () => {
    const world = createWorld({ preset: 'small', seed: 7 });
    world.tick();
    const first = world.creatures.find((c) => c.alive)!;
    const s1 = readSensors(world, first);
    expect(s1[SensorIndex.BIAS]).toBe(1);

    // Find an empty open tile within visionRadius of `first` and spawn an enemy without manual rebuildGrid().
    let spawned = false;
    for (let dx = -3; dx <= 3 && !spawned; dx++) {
      for (let dy = -3; dy <= 3 && !spawned; dy++) {
        if (dx === 0 && dy === 0) continue;
        const tx = first.x + dx;
        const ty = first.y + dy;
        const enemy = world.spawnCreature((first.tribeId + 1) % 3, tx, ty);
        if (enemy !== null) {
          spawned = true;
        }
      }
    }
    expect(spawned).toBe(true);
    const s2 = readSensors(world, first);
    expect(s2[SensorIndex.ENEMIES_IN_VISION]).toBeGreaterThan(0);
  });

  it('matches an independent brute-force oracle for all 18 sensors across random worlds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 20 }),
        (seed, ticks) => {
          const world = createWorld({ preset: 'small', seed });
          for (let t = 0; t < ticks; t++) {
            world.tick();
          }
          const buf = new Float32Array(SENSOR_COUNT);
          for (const c of world.creatures) {
            if (!c.alive) continue;
            const actual = readSensors(world, c, buf);
            const expected = bruteForceSensors(world, c);
            for (let i = 0; i < SENSOR_COUNT; i++) {
              expect(actual[i]).toBeCloseTo(expected[i]!, 5);
            }
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});
