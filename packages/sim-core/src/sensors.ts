import { isWaterReachable } from './actions.js';
import type { Creature } from './creature.js';
import { hidesCreatures } from './map/types.js';
import { NO_WATER_OFFSET } from './map/water-field.js';
import type { World } from './world.js';

/**
 * 18-input normalized creature sensor vector (plan §2.3).
 */
export const SENSOR_COUNT = 18;

export const SensorIndex = {
  ENERGY: 0,
  HYDRATION: 1,
  HEALTH: 2,
  FOOD_DX: 3,
  FOOD_DY: 4,
  WATER_DX: 5,
  WATER_DY: 6,
  ALLY_DX: 7,
  ALLY_DY: 8,
  ENEMY_DX: 9,
  ENEMY_DY: 10,
  ENEMIES_IN_VISION: 11,
  ALLIES_IN_VISION: 12,
  CURRENT_TILE_FOOD: 13,
  WATER_REACHABLE: 14,
  IN_FOREST: 15,
  ENEMY_ADJACENT: 16,
  BIAS: 17,
} as const;

export type SensorIndex = (typeof SensorIndex)[keyof typeof SensorIndex];

interface RingOffsets {
  readonly dx: Int16Array;
  readonly dy: Int16Array;
  readonly count: number;
}

const MAX_RING_CACHE_SIZE = 16;
const ringOffsetCache = new Map<number, RingOffsets>();

function getFoodRingOffsets(visionRadius: number): RingOffsets {
  if (!Number.isFinite(visionRadius) || visionRadius < 0 || Math.floor(visionRadius) > 32767) {
    throw new RangeError(`visionRadius must be a finite number in [0, 32768), got ${visionRadius}`);
  }

  const cached = ringOffsetCache.get(visionRadius);
  if (cached !== undefined) {
    return cached;
  }

  const rInt = Math.floor(visionRadius);
  const r2 = visionRadius * visionRadius;
  const entries: Array<{ readonly dx: number; readonly dy: number; readonly d2: number }> = [];

  for (let dy = -rInt; dy <= rInt; dy++) {
    for (let dx = -rInt; dx <= rInt; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) {
        entries.push({ dx, dy, d2 });
      }
    }
  }

  entries.sort((a, b) => {
    if (a.d2 !== b.d2) return a.d2 - b.d2;
    if (a.dy !== b.dy) return a.dy - b.dy;
    return a.dx - b.dx;
  });

  const dxArr = new Int16Array(entries.length);
  const dyArr = new Int16Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    dxArr[i] = entry.dx;
    dyArr[i] = entry.dy;
  }

  const built: RingOffsets = { dx: dxArr, dy: dyArr, count: entries.length };
  if (ringOffsetCache.size >= MAX_RING_CACHE_SIZE) {
    ringOffsetCache.clear();
  }
  ringOffsetCache.set(visionRadius, built);
  return built;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Reads the 18 normalized sensor inputs for `creature` in `world` (plan §2.3).
 * Pass a reusable `Float32Array` of length >= 18 as `out` in hot loops to avoid allocations.
 */
export function readSensors(world: World, creature: Creature, out?: Float32Array): Float32Array {
  if (out !== undefined && out.length < SENSOR_COUNT) {
    throw new RangeError(
      `readSensors output buffer needs length >= ${SENSOR_COUNT}, got ${out.length}`,
    );
  }
  const sensors = out ?? new Float32Array(SENSOR_COUNT);

  const { map, config, occupancy } = world;
  const { width, height, biomes, food, waterDx, waterDy } = map;
  const creatureCfg = config.creature;
  const sensorCfg = config.sensor;

  const cx = creature.x;
  const cy = creature.y;
  const selfIdx = cy * width + cx;

  // 0–2: Own normalized energy, hydration, health in [0, 1].
  sensors[SensorIndex.ENERGY] = clamp01(
    creatureCfg.maxEnergy > 0 ? creature.energy / creatureCfg.maxEnergy : 0,
  );
  sensors[SensorIndex.HYDRATION] = clamp01(
    creatureCfg.maxHydration > 0 ? creature.hydration / creatureCfg.maxHydration : 0,
  );
  sensors[SensorIndex.HEALTH] = clamp01(
    creatureCfg.maxHealth > 0 ? creature.health / creatureCfg.maxHealth : 0,
  );

  const vr = Number.isFinite(sensorCfg.visionRadius) ? Math.max(0, sensorCfg.visionRadius) : 0;
  const vr2 = vr * vr;
  const invVr = vr > 0 ? 1 / vr : 0;
  const forestMult = Number.isFinite(sensorCfg.forestVisionMultiplier)
    ? clamp01(sensorCfg.forestVisionMultiplier)
    : 0;
  const forestVr = vr * forestMult;
  const forestVr2 = forestVr * forestVr;

  // 3–4: Nearest visible food tile offset / visionRadius (0, 0 if none).
  let foodDxOut = 0;
  let foodDyOut = 0;
  const ring = getFoodRingOffsets(vr);
  const rDx = ring.dx;
  const rDy = ring.dy;
  for (let i = 0; i < ring.count; i++) {
    const ox = rDx[i]!;
    const oy = rDy[i]!;
    const tx = cx + ox;
    const ty = cy + oy;
    if (tx >= 0 && tx < width && ty >= 0 && ty < height && food[ty * width + tx]! > 0) {
      foodDxOut = ox * invVr;
      foodDyOut = oy * invVr;
      break;
    }
  }
  sensors[SensorIndex.FOOD_DX] = foodDxOut;
  sensors[SensorIndex.FOOD_DY] = foodDyOut;

  // 5–6: Nearest water offset within visionRadius / visionRadius (0, 0 if none).
  const rawWdx = waterDx[selfIdx]!;
  const rawWdy = waterDy[selfIdx]!;
  if (
    rawWdx !== NO_WATER_OFFSET &&
    rawWdy !== NO_WATER_OFFSET &&
    rawWdx * rawWdx + rawWdy * rawWdy <= vr2
  ) {
    sensors[SensorIndex.WATER_DX] = rawWdx * invVr;
    sensors[SensorIndex.WATER_DY] = rawWdy * invVr;
  } else {
    sensors[SensorIndex.WATER_DX] = 0;
    sensors[SensorIndex.WATER_DY] = 0;
  }

  // 7–12: Nearest ally/enemy offsets and visible counts via SpatialGrid.
  const grid = world.ensureGrid();
  const gridHead = grid.getHead();
  const gridNext = grid.getNext();
  const gridCreatures = grid.getCreatures();
  const cellSize = grid.cellSize;
  const cols = grid.cols;

  const minCx = Math.max(0, Math.floor((cx - vr) / cellSize));
  const maxCx = Math.min(cols - 1, Math.floor((cx + vr) / cellSize));
  const minCy = Math.max(0, Math.floor((cy - vr) / cellSize));
  const maxCy = Math.min(grid.rows - 1, Math.floor((cy + vr) / cellSize));

  const selfId = creature.id;
  const selfTribe = creature.tribeId;

  let allyCount = 0;
  let enemyCount = 0;
  let bestAllyD2 = Number.POSITIVE_INFINITY;
  let bestAllyId = Number.POSITIVE_INFINITY;
  let bestAllyDx = 0;
  let bestAllyDy = 0;
  let bestEnemyD2 = Number.POSITIVE_INFINITY;
  let bestEnemyId = Number.POSITIVE_INFINITY;
  let bestEnemyDx = 0;
  let bestEnemyDy = 0;

  for (let gy = minCy; gy <= maxCy; gy++) {
    const rowOffset = gy * cols;
    for (let gx = minCx; gx <= maxCx; gx++) {
      let idx = gridHead[rowOffset + gx]!;
      while (idx !== -1) {
        const other = gridCreatures[idx]!;
        if (other.alive && other.id !== selfId) {
          const dx = other.x - cx;
          const dy = other.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= vr2) {
            const limit2 = hidesCreatures(biomes[other.y * width + other.x]!) ? forestVr2 : vr2;
            if (d2 <= limit2) {
              if (other.tribeId === selfTribe) {
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
          }
        }
        idx = gridNext[idx]!;
      }
    }
  }

  sensors[SensorIndex.ALLY_DX] = bestAllyDx * invVr;
  sensors[SensorIndex.ALLY_DY] = bestAllyDy * invVr;
  sensors[SensorIndex.ENEMY_DX] = bestEnemyDx * invVr;
  sensors[SensorIndex.ENEMY_DY] = bestEnemyDy * invVr;

  const countNorm = sensorCfg.countNormalization;
  sensors[SensorIndex.ENEMIES_IN_VISION] =
    countNorm > 0 ? clamp01(enemyCount / countNorm) : enemyCount > 0 ? 1 : 0;
  sensors[SensorIndex.ALLIES_IN_VISION] =
    countNorm > 0 ? clamp01(allyCount / countNorm) : allyCount > 0 ? 1 : 0;

  // 13: Food amount on current tile normalized to [0, 1].
  const foodNorm = sensorCfg.foodNormalization;
  sensors[SensorIndex.CURRENT_TILE_FOOD] =
    foodNorm > 0 ? clamp01(food[selfIdx]! / foodNorm) : food[selfIdx]! > 0 ? 1 : 0;

  // 14: Water reachable (1 if on or 4-adjacent to water, else 0).
  sensors[SensorIndex.WATER_REACHABLE] = isWaterReachable(biomes, width, height, cx, cy) ? 1 : 0;

  // 15: In forest (1/0).
  sensors[SensorIndex.IN_FOREST] = hidesCreatures(biomes[selfIdx]!) ? 1 : 0;

  // 16: Enemy adjacent in 8-neighborhood (1/0).
  // Intentionally checks physical 8-adjacency via occupancy regardless of visionRadius or forest hiding.
  let enemyAdjacent = 0;
  const minNx = Math.max(0, cx - 1);
  const maxNx = Math.min(width - 1, cx + 1);
  const minNy = Math.max(0, cy - 1);
  const maxNy = Math.min(height - 1, cy + 1);
  for (let ny = minNy; ny <= maxNy && enemyAdjacent === 0; ny++) {
    const rowOff = ny * width;
    for (let nx = minNx; nx <= maxNx; nx++) {
      if (nx === cx && ny === cy) continue;
      const occId = occupancy[rowOff + nx]!;
      if (occId >= 0) {
        const occ = world.creatures[occId];
        if (occ !== undefined && occ.id === occId && occ.alive && occ.tribeId !== selfTribe) {
          enemyAdjacent = 1;
          break;
        }
      }
    }
  }
  sensors[SensorIndex.ENEMY_ADJACENT] = enemyAdjacent;

  // 17: Bias (constant 1).
  sensors[SensorIndex.BIAS] = 1;

  return sensors;
}
