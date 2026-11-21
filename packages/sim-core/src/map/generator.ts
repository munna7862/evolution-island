import {
  DEFAULT_CONFIG,
  type MapGenConfig,
  type MapPreset,
  type MapPresetId,
  type SimConfig,
} from '../config.js';
import { hashMap } from '../hash.js';
import { deriveRngStream, type RngStream, type Seed } from '../rng.js';
import { createSimplex2D, fbm2D } from './simplex.js';
import { Biome, isWalkable, type Hotspot, type SpawnZone, type WorldMap } from './types.js';
import { computeWaterField } from './water-field.js';

export interface GenerateMapOptions {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly config?: SimConfig;
}

const PI = 3.141592653589793;
const HALF_PI = PI * 0.5;

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Deterministic, trigonometry-free unit circle point [cos(2*pi*turn), sin(2*pi*turn)].
 * Uses quadrant reduction (|r| <= pi/4) and degree-12 (cos) / degree-13 (sin)
 * Taylor polynomials with only +, -, *, / and Math.floor/round (plan §3.3).
 */
export function unitCirclePoint(turn: number): readonly [number, number] {
  const wrapped = turn - Math.floor(turn);
  const q = Math.round(wrapped * 4);
  const r = (wrapped * 4 - q) * HALF_PI;
  const r2 = r * r;

  const cosR =
    1 +
    r2 *
      (-0.5 +
        r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 / 479001600)))));

  const sinR =
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 / 6227020800))))));

  const quadrant = q & 3;
  if (quadrant === 0) return [normalizeZero(cosR), normalizeZero(sinR)];
  if (quadrant === 1) return [normalizeZero(-sinR), normalizeZero(cosR)];
  if (quadrant === 2) return [normalizeZero(-cosR), normalizeZero(-sinR)];
  return [normalizeZero(sinR), normalizeZero(-cosR)];
}

/**
 * 4-connected BFS over walkable tiles starting from (startX, startY).
 * Returns a visited mask (1 = reachable walkable tile, 0 = unreachable or unwalkable).
 */
export function floodFillWalkable(
  biomes: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
): Uint8Array {
  const visited = new Uint8Array(width * height);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return visited;
  }

  const startIdx = startY * width + startX;
  if (!isWalkable(biomes[startIdx]!)) {
    return visited;
  }

  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  visited[startIdx] = 1;
  queue[tail] = startIdx;
  tail++;

  while (head < tail) {
    const idx = queue[head]!;
    head++;
    const y = Math.floor(idx / width);
    const x = idx - y * width;

    if (x > 0) {
      const n = idx - 1;
      if (visited[n] === 0 && isWalkable(biomes[n]!)) {
        visited[n] = 1;
        queue[tail] = n;
        tail++;
      }
    }
    if (x + 1 < width) {
      const n = idx + 1;
      if (visited[n] === 0 && isWalkable(biomes[n]!)) {
        visited[n] = 1;
        queue[tail] = n;
        tail++;
      }
    }
    if (y > 0) {
      const n = idx - width;
      if (visited[n] === 0 && isWalkable(biomes[n]!)) {
        visited[n] = 1;
        queue[tail] = n;
        tail++;
      }
    }
    if (y + 1 < height) {
      const n = idx + width;
      if (visited[n] === 0 && isWalkable(biomes[n]!)) {
        visited[n] = 1;
        queue[tail] = n;
        tail++;
      }
    }
  }

  return visited;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

interface CandidateMetrics {
  readonly spawnZones: readonly SpawnZone[];
  readonly failureReason: string | null;
}

function shapeDiskWalkable(
  biomes: Uint8Array,
  moistureGrid: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  dryCoreRadius: number,
  forestThreshold: number,
): void {
  const rInt = Math.ceil(radius);
  const r2 = radius * radius;
  const dryCoreR2 = dryCoreRadius * dryCoreRadius;
  const minX = Math.max(1, cx - rInt);
  const maxX = Math.min(width - 2, cx + rInt);
  const minY = Math.max(1, cy - rInt);
  const maxY = Math.min(height - 2, cy + rInt);

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      const idx = y * width + x;
      const b = biomes[idx]!;
      const inDryCore = d2 <= dryCoreR2;
      if (
        b === Biome.Mountain ||
        b === Biome.DeepWater ||
        (inDryCore && b === Biome.ShallowWater)
      ) {
        if (d2 <= 1) {
          biomes[idx] = Biome.Grass;
        } else {
          biomes[idx] = moistureGrid[idx]! > forestThreshold ? Biome.Forest : Biome.Grass;
        }
      }
    }
  }
}

function hasFourNeighbor(
  width: number,
  height: number,
  x: number,
  y: number,
  predicate: (idx: number) => boolean,
): boolean {
  const idx = y * width + x;
  if (x > 0 && predicate(idx - 1)) return true;
  if (x + 1 < width && predicate(idx + 1)) return true;
  if (y > 0 && predicate(idx - width)) return true;
  if (y + 1 < height && predicate(idx + width)) return true;
  return false;
}

/**
 * A water tile is drinkable if it is ShallowWater (walkable) or DeepWater
 * 4-adjacent to a walkable (or reachable-walkable) tile (plan §2.1).
 */
function isDrinkableWaterTile(
  biomes: Uint8Array,
  reachable: Uint8Array | null,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  const idx = y * width + x;
  const b = biomes[idx]!;
  if (b === Biome.ShallowWater) {
    return reachable === null || reachable[idx] === 1;
  }
  if (b === Biome.DeepWater) {
    return hasFourNeighbor(width, height, x, y, (nIdx) =>
      reachable === null ? isWalkable(biomes[nIdx]!) : reachable[nIdx] === 1,
    );
  }
  return false;
}

function countDrinkableWaterInRadius(
  biomes: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): number {
  const rInt = Math.ceil(radius);
  const r2 = radius * radius;
  const minX = Math.max(0, cx - rInt);
  const maxX = Math.min(width - 1, cx + rInt);
  const minY = Math.max(0, cy - rInt);
  const maxY = Math.min(height - 1, cy + rInt);
  let count = 0;

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2 && isDrinkableWaterTile(biomes, null, width, height, x, y)) {
        count++;
      }
    }
  }
  return count;
}

function placePondNearSpawn(
  biomes: Uint8Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
  mapCx: number,
  mapCy: number,
  preset: MapPreset,
  mapConfig: MapGenConfig,
  rng: RngStream,
): void {
  // Place a small shallow-water pond slightly inward or tangential inside fairnessRadius.
  const toCenterX = mapCx - sx;
  const toCenterY = mapCy - sy;
  const len = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);
  const dirX = len > 0 ? toCenterX / len : 1;
  const dirY = len > 0 ? toCenterY / len : 0;
  // Rotate slightly so ponds aren't always directly on the spawn-to-center line.
  const [rotX, rotY] = unitCirclePoint(
    rng.nextRange(-mapConfig.pondAngleJitter, mapConfig.pondAngleJitter),
  );
  const vx = dirX * rotX - dirY * rotY;
  const vy = dirX * rotY + dirY * rotX;

  const pondDist = preset.spawnZoneRadius * mapConfig.pondDistanceRatio;
  const px = clampInt(Math.round(sx + vx * pondDist), 3, width - 4);
  const py = clampInt(Math.round(sy + vy * pondDist), 3, height - 4);
  const pondRadius = mapConfig.pondRadius;
  const pondR2 = pondRadius * pondRadius;
  const pondRInt = Math.ceil(pondRadius);
  const dryCoreR2 = mapConfig.spawnDryCoreRadius * mapConfig.spawnDryCoreRadius;

  for (let dy = -pondRInt; dy <= pondRInt; dy++) {
    for (let dx = -pondRInt; dx <= pondRInt; dx++) {
      if (dx * dx + dy * dy > pondR2) continue;
      const x = px + dx;
      const y = py + dy;
      if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) continue;
      const dsx = x - sx;
      const dsy = y - sy;
      if (dsx * dsx + dsy * dsy <= dryCoreR2) continue;
      biomes[y * width + x] = Biome.ShallowWater;
    }
  }
}

function buildHotspots(
  preset: MapPreset,
  mapConfig: MapGenConfig,
  baseTurn: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
): readonly Hotspot[] {
  const hotspots: Hotspot[] = [];
  if (preset.hotspotCount <= 0) {
    return hotspots;
  }

  const centerX = clampInt(Math.round(cx), 2, width - 3);
  const centerY = clampInt(Math.round(cy), 2, height - 3);
  hotspots.push({ x: centerX, y: centerY, radius: preset.hotspotRadius });

  const outerCount = preset.hotspotCount - 1;
  if (outerCount <= 0) {
    return hotspots;
  }

  // Place outer hotspots on midpoints between tribes at a contested ring radius.
  const ringRadius = preset.spawnRingRadius * mapConfig.hotspotRingRatio;
  const offsetTurn = preset.tribeCount > 0 ? 0.5 / preset.tribeCount : 0;
  for (let i = 0; i < outerCount; i++) {
    const turn = baseTurn + offsetTurn + i / outerCount;
    const [ux, uy] = unitCirclePoint(turn);
    const hx = clampInt(Math.round(cx + ux * ringRadius), 2, width - 3);
    const hy = clampInt(Math.round(cy + uy * ringRadius), 2, height - 3);
    hotspots.push({ x: hx, y: hy, radius: preset.hotspotRadius });
  }

  return hotspots;
}

function verifyCandidate(
  biomes: Uint8Array,
  maxFood: Float32Array,
  preset: MapPreset,
  config: SimConfig,
  spawnCenters: readonly (readonly [number, number])[],
  hotspots: readonly Hotspot[],
): CandidateMetrics {
  const { width, height } = preset;
  if (spawnCenters.length === 0) {
    return { spawnZones: [], failureReason: 'no spawn centers configured' };
  }

  // 1. Border must be DeepWater (island ringed by deep water).
  for (let x = 0; x < width; x++) {
    if (biomes[x] !== Biome.DeepWater || biomes[(height - 1) * width + x] !== Biome.DeepWater) {
      return { spawnZones: [], failureReason: 'border tile is not DeepWater' };
    }
  }
  for (let y = 0; y < height; y++) {
    if (
      biomes[y * width] !== Biome.DeepWater ||
      biomes[y * width + (width - 1)] !== Biome.DeepWater
    ) {
      return { spawnZones: [], failureReason: 'border tile is not DeepWater' };
    }
  }

  // 2. 4-connected BFS from spawn 0 must reach every spawn center and hotspot center.
  const firstSpawn = spawnCenters[0]!;
  const reachable = floodFillWalkable(biomes, width, height, firstSpawn[0], firstSpawn[1]);

  for (let i = 0; i < spawnCenters.length; i++) {
    const [sx, sy] = spawnCenters[i]!;
    if (reachable[sy * width + sx] !== 1) {
      return {
        spawnZones: [],
        failureReason: `spawn ${i} at (${sx}, ${sy}) is not reachable from spawn 0`,
      };
    }
  }

  for (let i = 0; i < hotspots.length; i++) {
    const spot = hotspots[i]!;
    if (reachable[spot.y * width + spot.x] !== 1) {
      return {
        spawnZones: [],
        failureReason: `hotspot ${i} at (${spot.x}, ${spot.y}) is not reachable from spawn 0`,
      };
    }
  }

  // 3. Measure reachable capacity, food and drinkable water per spawn zone.
  const minRequiredWalkable = Math.ceil(config.map.spawnCapacityMultiplier * preset.popCapPerTribe);
  const spawnZones: SpawnZone[] = [];
  let totalFood = 0;
  let totalWater = 0;

  const zoneR2 = preset.spawnZoneRadius * preset.spawnZoneRadius;
  const fairR = preset.fairnessRadius;
  const fairR2 = fairR * fairR;
  const scanRInt = Math.ceil(Math.max(preset.spawnZoneRadius, fairR));

  for (let tribeId = 0; tribeId < spawnCenters.length; tribeId++) {
    const [sx, sy] = spawnCenters[tribeId]!;
    const minX = Math.max(0, sx - scanRInt);
    const maxX = Math.min(width - 1, sx + scanRInt);
    const minY = Math.max(0, sy - scanRInt);
    const maxY = Math.min(height - 1, sy + scanRInt);

    let zoneWalkable = 0;
    let foodSum = 0;
    let waterCount = 0;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - sy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - sx;
        const d2 = dx * dx + dy * dy;
        const idx = y * width + x;

        if (d2 <= zoneR2 && reachable[idx] === 1) {
          zoneWalkable++;
        }
        if (d2 <= fairR2) {
          if (reachable[idx] === 1) {
            foodSum += maxFood[idx]!;
          }
          if (isDrinkableWaterTile(biomes, reachable, width, height, x, y)) {
            waterCount++;
          }
        }
      }
    }

    if (zoneWalkable < minRequiredWalkable) {
      return {
        spawnZones: [],
        failureReason: `spawn ${tribeId} has ${zoneWalkable} walkable tiles, needs ${minRequiredWalkable}`,
      };
    }
    if (waterCount < config.map.minFairnessWaterTiles) {
      return {
        spawnZones: [],
        failureReason: `spawn ${tribeId} has ${waterCount} drinkable water tiles, needs ${config.map.minFairnessWaterTiles}`,
      };
    }

    totalFood += foodSum;
    totalWater += waterCount;
    spawnZones.push({
      tribeId,
      x: sx,
      y: sy,
      radius: preset.spawnZoneRadius,
      walkableCount: zoneWalkable,
      foodInFairnessRadius: foodSum,
      waterInFairnessRadius: waterCount,
    });
  }

  // 4. Verify food and drinkable water fairness within ±fairnessTolerance of tribe mean.
  const n = spawnZones.length;
  const meanFood = totalFood / n;
  const meanWater = totalWater / n;
  if (meanFood <= 0 || meanWater <= 0) {
    return { spawnZones: [], failureReason: 'zero mean food or water across spawn zones' };
  }

  const tol = config.map.fairnessTolerance;
  for (const zone of spawnZones) {
    const foodDiff = Math.abs(zone.foodInFairnessRadius - meanFood) / meanFood;
    if (foodDiff > tol) {
      return {
        spawnZones: [],
        failureReason: `tribe ${zone.tribeId} food deviation ${(foodDiff * 100).toFixed(1)}% exceeds ${(tol * 100).toFixed(1)}%`,
      };
    }
    const waterDiff = Math.abs(zone.waterInFairnessRadius - meanWater) / meanWater;
    if (waterDiff > tol) {
      return {
        spawnZones: [],
        failureReason: `tribe ${zone.tribeId} water deviation ${(waterDiff * 100).toFixed(1)}% exceeds ${(tol * 100).toFixed(1)}%`,
      };
    }
  }

  return { spawnZones, failureReason: null };
}

function generateAttempt(
  preset: MapPreset,
  seed: Seed,
  attempt: number,
  config: SimConfig,
): { readonly map: WorldMap | null; readonly failureReason: string } {
  const rng = deriveRngStream(seed, `map::${attempt}`);
  const elevNoise = createSimplex2D(rng);
  const moistNoise = createSimplex2D(rng);
  const elevOffsetX = rng.nextRange(-500, 500);
  const elevOffsetY = rng.nextRange(-500, 500);
  const moistOffsetX = rng.nextRange(-500, 500);
  const moistOffsetY = rng.nextRange(-500, 500);
  const baseTurn = rng.nextFloat();

  const { width, height } = preset;
  const size = width * height;
  const biomes = new Uint8Array(size);
  const moistureGrid = new Float32Array(size);
  const maxFood = new Float32Array(size);

  const cx = (width - 1) * 0.5;
  const cy = (height - 1) * 0.5;
  const invHalfW = 2 / width;
  const invHalfH = 2 / height;

  const {
    elevationScale,
    elevationOctaves,
    elevationAmplitude,
    islandCoreLift,
    moistureScale,
    moistureOctaves,
    fbmLacunarity,
    fbmGain,
    islandPlateauRadius,
    islandCoastRadius,
    falloffStrength,
    deepWaterThreshold,
    shallowWaterThreshold,
    sandThreshold,
    mountainThreshold,
    forestMoistureThreshold,
    biomeMaxFood,
    hotspotMaxFood,
    moistureFoodBonus,
    spawnAngularJitter,
    spawnDryCoreRadius,
    hotspotClearingRatio,
    hotspotMinClearingRadius,
    hotspotEdgeBoost,
    targetFairnessWaterTiles,
  } = config.map;

  const falloffSpan = Math.max(1e-6, islandCoastRadius - islandPlateauRadius);

  // 1. Sample elevation & moisture fBM + radial island falloff.
  for (let y = 0; y < height; y++) {
    const ny = (y - cy) * invHalfH;
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        biomes[idx] = Biome.DeepWater;
        moistureGrid[idx] = 0;
        continue;
      }

      const nx = (x - cx) * invHalfW;
      const dist = Math.sqrt(nx * nx + ny * ny);
      const falloff = smoothstep01((dist - islandPlateauRadius) / falloffSpan);

      const rawElev = fbm2D(
        elevNoise,
        x * elevationScale + elevOffsetX,
        y * elevationScale + elevOffsetY,
        elevationOctaves,
        fbmLacunarity,
        fbmGain,
      );
      const rawMoist = fbm2D(
        moistNoise,
        x * moistureScale + moistOffsetX,
        y * moistureScale + moistOffsetY,
        moistureOctaves,
        fbmLacunarity,
        fbmGain,
      );

      moistureGrid[idx] = rawMoist;

      const elevation = rawElev * elevationAmplitude + islandCoreLift - falloff * falloffStrength;

      if (elevation < deepWaterThreshold) {
        biomes[idx] = Biome.DeepWater;
      } else if (elevation < shallowWaterThreshold) {
        biomes[idx] = Biome.ShallowWater;
      } else if (elevation < sandThreshold) {
        biomes[idx] = Biome.Sand;
      } else if (elevation > mountainThreshold) {
        biomes[idx] = Biome.Mountain;
      } else if (rawMoist > forestMoistureThreshold) {
        biomes[idx] = Biome.Forest;
      } else {
        biomes[idx] = Biome.Grass;
      }
    }
  }

  // 2a. Pass A: place balanced tribe spawn centers and condition spawn disks before water checks.
  const spawnCenters: [number, number][] = [];
  for (let t = 0; t < preset.tribeCount; t++) {
    const jitter =
      spawnAngularJitter > 0 ? rng.nextRange(-spawnAngularJitter, spawnAngularJitter) : 0;
    const turn = baseTurn + t / preset.tribeCount + jitter;
    const [ux, uy] = unitCirclePoint(turn);
    const sx = clampInt(Math.round(cx + ux * preset.spawnRingRadius), 3, width - 4);
    const sy = clampInt(Math.round(cy + uy * preset.spawnRingRadius), 3, height - 4);
    spawnCenters.push([sx, sy]);

    shapeDiskWalkable(
      biomes,
      moistureGrid,
      width,
      height,
      sx,
      sy,
      preset.spawnZoneRadius,
      spawnDryCoreRadius,
      forestMoistureThreshold,
    );
  }

  // 2b. Pass B: ensure each spawn zone has a local drinkable water source if natural water is scarce.
  for (const [sx, sy] of spawnCenters) {
    const existingWater = countDrinkableWaterInRadius(
      biomes,
      width,
      height,
      sx,
      sy,
      preset.fairnessRadius,
    );
    if (existingWater < targetFairnessWaterTiles) {
      placePondNearSpawn(biomes, width, height, sx, sy, cx, cy, preset, config.map, rng);
    }
  }

  // 3. Place contested hotspots and ensure their cores are dry walkable land.
  const hotspots = buildHotspots(preset, config.map, baseTurn, cx, cy, width, height);
  for (const spot of hotspots) {
    const clearRadius = Math.max(hotspotMinClearingRadius, spot.radius * hotspotClearingRatio);
    shapeDiskWalkable(
      biomes,
      moistureGrid,
      width,
      height,
      spot.x,
      spot.y,
      clearRadius,
      clearRadius,
      forestMoistureThreshold,
    );
  }

  // 4. Populate per-tile maxFood from biome + moisture modulation + hotspot boosts.
  for (let i = 0; i < size; i++) {
    const b = biomes[i]!;
    const baseFood = biomeMaxFood[b] ?? 0;
    if (baseFood <= 0) {
      maxFood[i] = 0;
    } else if (b === Biome.Grass || b === Biome.Forest) {
      const m = Math.max(-1, Math.min(1, moistureGrid[i]!));
      maxFood[i] = Math.round(baseFood * (1 + moistureFoodBonus * m));
    } else {
      maxFood[i] = baseFood;
    }
  }

  for (const spot of hotspots) {
    const rInt = Math.ceil(spot.radius);
    const r2 = spot.radius * spot.radius;
    const minX = Math.max(1, spot.x - rInt);
    const maxX = Math.min(width - 2, spot.x + rInt);
    const minY = Math.max(1, spot.y - rInt);
    const maxY = Math.min(height - 2, spot.y + rInt);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - spot.y;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - spot.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const idx = y * width + x;
        const b = biomes[idx]!;
        if (b !== Biome.Grass && b !== Biome.Forest && b !== Biome.Sand) continue;

        const falloff = 1 - Math.sqrt(d2) / Math.max(1, spot.radius);
        const base = biomeMaxFood[b];
        const boost = Math.round(
          base + (hotspotMaxFood - base) * (hotspotEdgeBoost + (1 - hotspotEdgeBoost) * falloff),
        );
        if (boost > maxFood[idx]!) {
          maxFood[idx] = boost;
        }
      }
    }
  }

  // 5. Verify border, 4-connected reachability, spawn capacity, and ±15% fairness.
  const verification = verifyCandidate(biomes, maxFood, preset, config, spawnCenters, hotspots);
  if (verification.failureReason !== null) {
    return { map: null, failureReason: verification.failureReason };
  }

  // 6. Compute nearest-water distance field, walkableCount and canonical map hash.
  const waterField = computeWaterField(biomes, width, height);
  let walkableCount = 0;
  for (let i = 0; i < size; i++) {
    if (isWalkable(biomes[i]!)) {
      walkableCount++;
    }
  }

  const food = new Float32Array(maxFood);
  const partialMap: Omit<WorldMap, 'hash'> = {
    width,
    height,
    preset: preset.id,
    seed,
    attempt,
    walkableCount,
    biomes,
    maxFood,
    food,
    waterDx: waterField.dx,
    waterDy: waterField.dy,
    spawnZones: verification.spawnZones,
    hotspots,
  };

  return {
    map: {
      ...partialMap,
      hash: hashMap(partialMap),
    },
    failureReason: '',
  };
}

/**
 * Generates a deterministic, balanced island WorldMap for the given preset and seed.
 * Retries with derived seeds (`map::<attempt>`) until fairness & connectivity checks pass.
 */
export function generateMap(options: GenerateMapOptions): WorldMap {
  const config = options.config ?? DEFAULT_CONFIG;
  const preset = config.presets[options.preset];
  const maxAttempts = config.map.maxGenerationAttempts;
  let lastFailure = 'maxGenerationAttempts is 0';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = generateAttempt(preset, options.seed, attempt, config);
    if (result.map !== null) {
      return result.map;
    }
    lastFailure = result.failureReason;
  }

  throw new Error(
    `Failed to generate ${options.preset} map for seed ${String(options.seed)} within ${maxAttempts} attempts (last failure: ${lastFailure})`,
  );
}
