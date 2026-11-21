/**
 * Central configuration and map presets (plan §2.1, §2.2, §3.3).
 * All balance and generation numbers live here so nothing is hard-coded in logic.
 */

export type MapPresetId = 'small' | 'medium' | 'large' | 'huge';

export interface MapPreset {
  readonly id: MapPresetId;
  readonly width: number;
  readonly height: number;
  readonly tribeCount: number;
  readonly startingCreaturesPerTribe: number;
  readonly minTribeSize: number;
  readonly popCapPerTribe: number;
  readonly generationLength: number;
  readonly spawnRingRadius: number;
  readonly spawnZoneRadius: number;
  readonly fairnessRadius: number;
  readonly hotspotCount: number;
  readonly hotspotRadius: number;
}

export interface MapGenConfig {
  readonly elevationScale: number;
  readonly elevationOctaves: number;
  readonly elevationAmplitude: number;
  readonly islandCoreLift: number;
  readonly moistureScale: number;
  readonly moistureOctaves: number;
  readonly fbmLacunarity: number;
  readonly fbmGain: number;
  readonly islandPlateauRadius: number;
  readonly islandCoastRadius: number;
  readonly falloffStrength: number;
  readonly deepWaterThreshold: number;
  readonly shallowWaterThreshold: number;
  readonly sandThreshold: number;
  readonly mountainThreshold: number;
  readonly forestMoistureThreshold: number;
  readonly biomeMaxFood: readonly [number, number, number, number, number, number];
  readonly hotspotMaxFood: number;
  readonly moistureFoodBonus: number;
  readonly spawnAngularJitter: number;
  readonly spawnDryCoreRadius: number;
  readonly pondDistanceRatio: number;
  readonly pondRadius: number;
  readonly pondAngleJitter: number;
  readonly hotspotRingRatio: number;
  readonly hotspotClearingRatio: number;
  readonly hotspotMinClearingRadius: number;
  readonly hotspotEdgeBoost: number;
  readonly fairnessTolerance: number;
  readonly minFairnessWaterTiles: number;
  readonly targetFairnessWaterTiles: number;
  readonly spawnCapacityMultiplier: number;
  readonly maxGenerationAttempts: number;
}

export interface CreatureConfig {
  readonly maxHealth: number;
  readonly maxEnergy: number;
  readonly maxHydration: number;
  readonly baseEnergyDrain: number;
  readonly baseHydrationDrain: number;
  readonly moveEnergyCost: number;
  readonly slowTileMoveMultiplier: number;
  readonly slowTileMoveCooldown: number;
  readonly starvationHealthDrain: number;
  readonly dehydrationHealthDrain: number;
  readonly healthRegenRate: number;
  readonly regenThresholdRatio: number;
  readonly eatBiteSize: number;
  readonly drinkBiteSize: number;
  readonly attackEnergyCost: number;
  readonly maxAgeMultiplier: number;
}

export interface FoodConfig {
  readonly regrowthRate: number;
}

export interface SensorConfig {
  readonly visionRadius: number;
  readonly forestVisionMultiplier: number;
  readonly countNormalization: number;
  readonly foodNormalization: number;
  /**
   * The "nearest food" sensor only sees tiles holding at least this much food. Without it, almost
   * every land tile (including freshly grazed, regrowing ones) counts as food and the sensor is
   * nearly always (0, 0).
   */
  readonly minVisibleFood: number;
}

export interface BrainConfig {
  /** Hidden-layer size of the fixed-topology MLP (plan §2.4). */
  readonly hiddenNeurons: number;
}

export interface SimConfig {
  readonly presets: Readonly<Record<MapPresetId, MapPreset>>;
  readonly map: MapGenConfig;
  readonly creature: CreatureConfig;
  readonly food: FoodConfig;
  readonly sensor: SensorConfig;
  readonly brain: BrainConfig;
}

export const MAP_PRESETS: Readonly<Record<MapPresetId, MapPreset>> = {
  small: {
    id: 'small',
    width: 64,
    height: 64,
    tribeCount: 2,
    startingCreaturesPerTribe: 25,
    minTribeSize: 25,
    popCapPerTribe: 50,
    generationLength: 1500,
    spawnRingRadius: 14,
    spawnZoneRadius: 8,
    fairnessRadius: 11,
    hotspotCount: 3,
    hotspotRadius: 3,
  },
  medium: {
    id: 'medium',
    width: 128,
    height: 128,
    tribeCount: 4,
    startingCreaturesPerTribe: 50,
    minTribeSize: 25,
    popCapPerTribe: 100,
    generationLength: 2000,
    spawnRingRadius: 30,
    spawnZoneRadius: 12,
    fairnessRadius: 18,
    hotspotCount: 5,
    hotspotRadius: 5,
  },
  large: {
    id: 'large',
    width: 256,
    height: 256,
    tribeCount: 6,
    startingCreaturesPerTribe: 80,
    minTribeSize: 25,
    popCapPerTribe: 160,
    generationLength: 3000,
    spawnRingRadius: 62,
    spawnZoneRadius: 16,
    fairnessRadius: 25,
    hotspotCount: 7,
    hotspotRadius: 7,
  },
  huge: {
    id: 'huge',
    width: 512,
    height: 512,
    tribeCount: 8,
    startingCreaturesPerTribe: 150,
    minTribeSize: 25,
    popCapPerTribe: 300,
    generationLength: 4000,
    spawnRingRadius: 128,
    spawnZoneRadius: 22,
    fairnessRadius: 36,
    hotspotCount: 9,
    hotspotRadius: 10,
  },
};

export const DEFAULT_CONFIG: SimConfig = {
  presets: MAP_PRESETS,
  map: {
    elevationScale: 0.045,
    elevationOctaves: 4,
    elevationAmplitude: 1.15,
    islandCoreLift: 0.14,
    moistureScale: 0.035,
    moistureOctaves: 3,
    fbmLacunarity: 2,
    fbmGain: 0.5,
    islandPlateauRadius: 0.62,
    islandCoastRadius: 0.96,
    falloffStrength: 1.35,
    deepWaterThreshold: -0.22,
    shallowWaterThreshold: -0.08,
    sandThreshold: 0.02,
    mountainThreshold: 0.56,
    forestMoistureThreshold: 0.12,
    // Indexed by Biome enum: [DeepWater, ShallowWater, Sand, Grass, Forest, Mountain]
    biomeMaxFood: [0, 0, 15, 60, 100, 0],
    hotspotMaxFood: 160,
    moistureFoodBonus: 0.2,
    spawnAngularJitter: 0.015,
    spawnDryCoreRadius: 2,
    pondDistanceRatio: 0.72,
    pondRadius: 2.05,
    pondAngleJitter: 0.18,
    hotspotRingRatio: 0.72,
    hotspotClearingRatio: 0.6,
    hotspotMinClearingRadius: 2,
    hotspotEdgeBoost: 0.4,
    fairnessTolerance: 0.15,
    minFairnessWaterTiles: 6,
    targetFairnessWaterTiles: 12,
    spawnCapacityMultiplier: 2,
    maxGenerationAttempts: 64,
  },
  creature: {
    maxHealth: 100,
    maxEnergy: 100,
    maxHydration: 100,
    baseEnergyDrain: 0.25,
    baseHydrationDrain: 0.3,
    moveEnergyCost: 0.35,
    slowTileMoveMultiplier: 2,
    slowTileMoveCooldown: 1,
    starvationHealthDrain: 0.5,
    dehydrationHealthDrain: 0.5,
    healthRegenRate: 0.25,
    regenThresholdRatio: 0.5,
    eatBiteSize: 20,
    drinkBiteSize: 25,
    attackEnergyCost: 0.5,
    maxAgeMultiplier: 2,
  },
  food: {
    regrowthRate: 0.15,
  },
  sensor: {
    visionRadius: 8,
    forestVisionMultiplier: 0.5,
    countNormalization: 5,
    foodNormalization: 160,
    minVisibleFood: 20, // one full bite (creature.eatBiteSize)
  },
  brain: {
    hiddenNeurons: 12,
  },
};
