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
  /** Health an `ATTACK` takes from its target (plan §2.3). */
  readonly attackDamage: number;
  /** Share of the victim's remaining energy the killing blow gains (plan §2.3). */
  readonly killEnergyFraction: number;
  /** Energy a valid `SHARE` takes from the giver. */
  readonly shareAmount: number;
  /** Share of `shareAmount` the recipient gains (the rest is lost). */
  readonly shareEfficiency: number;
  /** A `SHARE` only helps an ally below this fraction of max energy (plan §2.3). */
  readonly shareNeedRatio: number;
  /** The giver must keep at least this fraction of max energy after a `SHARE` (Sprint 4.1). */
  readonly shareKeepRatio: number;
  readonly maxAgeMultiplier: number;
}

export interface FoodConfig {
  readonly regrowthRate: number;
}

/**
 * Climate & disasters (plan §4 Sprint 7.2). With `enabled` the world changes by itself: a year
 * of `yearLength` ticks ends in winter (food regrows slower), droughts dry shallow water to sand
 * and floods turn land to shallow water for a while (the water field is recomputed), and a food
 * zone where food regrows faster wanders over the land. Spectator events (drought, flood, winter,
 * food zone) work whether or not it is enabled. Ticks count from the generation start; every
 * generation starts with the map as generated.
 */
export interface ClimateConfig {
  readonly enabled: boolean;
  readonly yearLength: number;
  /** The last this fraction of every year is winter. */
  readonly winterFraction: number;
  readonly winterRegrowthMultiplier: number;
  /** A spectator's winter lasts this many ticks. */
  readonly winterEventDuration: number;
  /** Every this many ticks, a drought and a flood may each start (chances below). */
  readonly disasterCheckInterval: number;
  readonly droughtChance: number;
  readonly droughtRadius: number;
  readonly droughtDuration: number;
  readonly floodChance: number;
  readonly floodRadius: number;
  readonly floodDuration: number;
  readonly foodZoneRadius: number;
  readonly foodZoneRegrowthMultiplier: number;
  /** The food zone moves `foodZoneStep` tiles in a random direction every this many ticks. */
  readonly foodZoneMoveInterval: number;
  readonly foodZoneStep: number;
}

/** Territory (plan §2.6): ownership fades without sustained presence. */
export interface TerritoryConfig {
  /** A tile stays owned this many ticks after its owner's last visit. */
  readonly decayTicks: number;
  /** Territory % is recounted (and old ownership dropped) every this many ticks. */
  readonly updateInterval: number;
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

/** Calls (plan §2.3 "Signals", Sprint 4.3). */
export interface SignalConfig {
  /** Adds 1 call output and 3 "loudest ally call" inputs to the brain. */
  readonly enabled: boolean;
  /** A call (0..1) below this is silent. */
  readonly callThreshold: number;
  /** Allies within this distance (tiles, Euclidean) hear a call; farther than vision. */
  readonly callRadius: number;
  /** Energy a creature pays for each tick it calls. */
  readonly callCost: number;
}

export interface BrainConfig {
  /** Hidden-layer size of the fixed-topology MLP (plan §2.4). */
  readonly hiddenNeurons: number;
  /**
   * Memory neurons (plan §2.3, Sprint 3.5): this many extra outputs, squashed to −1..1, are fed
   * back as as many extra inputs on the next tick. 0 = memory off.
   */
  readonly memoryNeurons: number;
}

/** Per-creature fitness weights (plan §2.5). */
export interface FitnessWeights {
  readonly ticksAlive: number;
  /** Per bite of energy actually gained (not per EAT action). */
  readonly foodEaten: number;
  /** Per bite of hydration actually gained (not per DRINK action). */
  readonly waterDrunk: number;
  readonly alliesHelped: number;
  readonly kills: number;
}

/** Tribe score weights: drive next generation's tribe sizes (plan §2.5, §2.6). */
export interface TribeScoreWeights {
  /** Per creature alive at generation end. */
  readonly survivors: number;
  /** Per bite of food actually eaten by the tribe. */
  readonly foodGathered: number;
  /** Per percentage point of territory (measured since Sprint 4.1; weight tuned in 4.2). */
  readonly territory: number;
}

export type SelectionMode = 'truncation' | 'tournament';
export type ExtinctionMode = 'respawn' | 'battle-royale';

export interface EvolutionConfig {
  readonly fitness: FitnessWeights;
  /** Valid SHAREs counted per creature per generation (plan §2.5). */
  readonly maxAlliesHelped: number;
  readonly selection: SelectionMode;
  /** Truncation: the top fraction of a tribe that may parent offspring. */
  readonly parentFraction: number;
  readonly tournamentSize: number;
  /** Best creatures per tribe copied unchanged into the next generation. */
  readonly eliteCount: number;
  /** Per-hidden-neuron crossover; false = mutation-only offspring. */
  readonly crossover: boolean;
  /** Chance that each weight of an offspring is mutated. */
  readonly mutationRate: number;
  /** Standard deviation of the Gaussian mutation noise. */
  readonly mutationSigma: number;
  /** Weights are clamped to [-weightClamp, weightClamp]. */
  readonly weightClamp: number;
  /** Generation-1 weights are uniform in [-initialWeightRange, initialWeightRange). */
  readonly initialWeightRange: number;
  readonly tribeScore: TribeScoreWeights;
  readonly extinction: ExtinctionMode;
  /**
   * Battle royale only (Sprint 4.2): the first generation whose end can eliminate a tribe. Before
   * it, extinct tribes respawn as in normal mode; untrained tribes all die out in generation 1,
   * which would end a battle royale at once.
   */
  readonly battleRoyaleFromGeneration: number;
  /** Champions kept per tribe, best benchmark score first. */
  readonly hallOfFameSize: number;
  /** Benchmark champions at generation 1 and every N generations. */
  readonly benchmarkInterval: number;
  /** Seed of the benchmark arena's fixed map. */
  readonly benchmarkSeed: string;
}

export interface SimConfig {
  readonly presets: Readonly<Record<MapPresetId, MapPreset>>;
  readonly map: MapGenConfig;
  readonly creature: CreatureConfig;
  readonly food: FoodConfig;
  readonly climate: ClimateConfig;
  readonly territory: TerritoryConfig;
  readonly sensor: SensorConfig;
  readonly signals: SignalConfig;
  readonly brain: BrainConfig;
  readonly evolution: EvolutionConfig;
}

/**
 * Generation lengths were doubled in Sprint 3.4 (1,500/2,000/3,000/4,000 before). An untrained
 * creature dies by tick ~500–700 whatever the length, while one that has learned to reach water
 * and eat keeps living, so a longer generation gives selection more ticks in which seeking food
 * and water pays, and lets the benchmark arena tell learners from non-learners well above the
 * noise (Small sweep, 100 generations: 1,500 → 2,000 → 3,000 ticks met the Sprint 3.4 bar on
 * 1 → 9 → 15 of 20 seeds).
 */
export const MAP_PRESETS: Readonly<Record<MapPresetId, MapPreset>> = {
  small: {
    id: 'small',
    width: 64,
    height: 64,
    tribeCount: 2,
    startingCreaturesPerTribe: 25,
    minTribeSize: 25,
    popCapPerTribe: 50,
    generationLength: 3000,
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
    generationLength: 4000,
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
    generationLength: 6000,
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
    generationLength: 8000,
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
    // Sprint 3.4: 0.25 → 0.2, so thirst is what kills first. At 0.25, eating alone added ~67 ticks
    // of life on almost any tile and whole tribes locked into "always EAT", never drinking. An
    // only-STAY creature still dies by tick ~520 (balance rule, plan §2.3).
    baseEnergyDrain: 0.2,
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
    // Sprint 4.1 (plan §2.3): five hits kill a full-health creature (the sixth if it is hit once
    // per tick and well fed, healing 0.25 a tick in between); the killing blow gains half the
    // victim's remaining energy. First values, tuned in Sprint 4.2.
    attackDamage: 20,
    killEnergyFraction: 0.5,
    // A valid SHARE moves 10 energy at 80 %, from a giver that keeps ≥ 50 % to an ally below
    // 50 %. The keep rule stops two hungry allies passing energy back and forth for fitness.
    shareAmount: 10,
    shareEfficiency: 0.8,
    shareNeedRatio: 0.5,
    shareKeepRatio: 0.5,
    maxAgeMultiplier: 2,
  },
  food: {
    regrowthRate: 0.15,
  },
  // Sprint 7.2 first values: a quarter-year winter at a quarter of the regrowth, rare local
  // disasters (a ~15 % chance each per 500 ticks), and a food zone regrowing 3× as fast.
  climate: {
    enabled: true,
    yearLength: 1000,
    winterFraction: 0.25,
    winterRegrowthMultiplier: 0.25,
    winterEventDuration: 300,
    disasterCheckInterval: 500,
    droughtChance: 0.15,
    droughtRadius: 10,
    droughtDuration: 600,
    floodChance: 0.15,
    floodRadius: 8,
    floodDuration: 400,
    foodZoneRadius: 8,
    foodZoneRegrowthMultiplier: 3,
    foodZoneMoveInterval: 200,
    foodZoneStep: 4,
  },
  territory: {
    // A tenth of a Small generation: territory means sustained presence, not footprints.
    decayTicks: 300,
    updateInterval: 10,
  },
  sensor: {
    visionRadius: 8,
    forestVisionMultiplier: 0.5,
    countNormalization: 5,
    foodNormalization: 160,
    minVisibleFood: 20, // one full bite (creature.eatBiteSize)
  },
  // Off unless the Sprint 4.3 A/B shows calls help (plan §2.3, §4).
  signals: {
    enabled: false,
    callThreshold: 0.5,
    callRadius: 16,
    callCost: 0.1,
  },
  brain: {
    hiddenNeurons: 12,
    // Sprint 3.5 A/B (50 held-out Small seeds, memory on vs off from scratch): tribe scores 1.11×
    // on the normal map and 1.67× on a sparse-water map (better on 48 of 50 seeds), so memory is
    // on. Zeroing the memory inputs of the evolved champions cuts their arena score to 0.60× /
    // 0.34×: memory carries information (mostly a way to change direction when nothing in sight
    // changes, i.e. to search). 0 switches it off.
    memoryNeurons: 2,
  },
  evolution: {
    fitness: { ticksAlive: 1, foodEaten: 2, waterDrunk: 1, alliesHelped: 5, kills: 10 },
    maxAlliesHelped: 10,
    // Sprint 3.4 sweeps (Small, 100 generations): tournament selection, ±1 initial weights and
    // σ 0.6 each beat truncation, ±2 and σ 0.2; together with the drain and generation-length
    // changes they took the share of seeds meeting the bar from 0/20 to 25/40.
    selection: 'tournament',
    parentFraction: 0.2,
    tournamentSize: 3,
    eliteCount: 2,
    crossover: true,
    mutationRate: 0.05,
    mutationSigma: 0.6,
    weightClamp: 4,
    initialWeightRange: 1,
    tribeScore: { survivors: 1, foodGathered: 1, territory: 0 },
    extinction: 'respawn',
    // Sprint 4.2: on Medium, after ~100 generations a tribe dies out in only 5–11 % of
    // generations (tribes of 60+ never), so a battle royale is decided by play, not by luck.
    battleRoyaleFromGeneration: 100,
    hallOfFameSize: 5,
    benchmarkInterval: 10,
    benchmarkSeed: 'benchmark-arena',
  },
};
