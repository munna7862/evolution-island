export {
  Biome,
  hidesCreatures,
  isSlow,
  isWalkable,
  isWater,
  type Hotspot,
  type SpawnZone,
  type WaterField,
  type WorldMap,
} from './types.js';
export { createSimplex2D, fbm2D, type Noise2D } from './simplex.js';
export { computeWaterField, NO_WATER_OFFSET } from './water-field.js';
export {
  floodFillWalkable,
  generateMap,
  unitCirclePoint,
  type GenerateMapOptions,
} from './generator.js';
