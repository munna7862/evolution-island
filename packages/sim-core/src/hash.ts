import type { MapPresetId, SimConfig } from './config.js';
import type { WorldMap } from './map/types.js';
import { normalizeSeed } from './rng.js';
import { SIM_VERSION } from './version.js';
import type { World } from './world.js';

const PRESET_ORDER: readonly MapPresetId[] = ['small', 'medium', 'large', 'huge'];

/**
 * Deterministic 64-bit state hasher (two 32-bit mixed lanes, zero BigInt or host dependencies).
 * Used for determinism tests, map hashes, config hashes and replay checkpoints (plan §3.2, §3.3).
 */
export class StateHasher {
  private h1 = 0x9e3779b9;
  private h2 = 0x85ebca6b;
  private readonly buffer = new ArrayBuffer(8);
  private readonly view = new DataView(this.buffer);

  private mix32(value: number): void {
    const v = value | 0;
    let a = (this.h1 ^ v) | 0;
    a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
    a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
    a ^= a >>> 16;

    let b = (this.h2 + Math.imul(v ^ 0x27d4eb2f, 0x165667b1)) | 0;
    b = (b << 13) | (b >>> 19);
    b = (Math.imul(b, 5) + 0xe6546b64) | 0;

    this.h1 = (a ^ b) >>> 0;
    this.h2 = (b ^ ((this.h1 << 7) | (this.h1 >>> 25))) >>> 0;
  }

  writeBoolean(value: boolean): this {
    this.mix32(value ? 1 : 0);
    return this;
  }

  writeUint8(value: number): this {
    this.mix32(value & 0xff);
    return this;
  }

  writeInt16(value: number): this {
    this.mix32((value << 16) >> 16);
    return this;
  }

  writeInt32(value: number): this {
    this.mix32(value | 0);
    return this;
  }

  writeUint32(value: number): this {
    this.mix32(value >>> 0);
    return this;
  }

  writeFloat32(value: number): this {
    if (Number.isNaN(value)) {
      this.mix32(0x7fc00000);
      return this;
    }
    const f32 = Math.fround(value);
    const canonical = f32 === 0 ? 0 : f32;
    this.view.setFloat32(0, canonical, true);
    this.mix32(this.view.getUint32(0, true));
    return this;
  }

  writeFloat64(value: number): this {
    if (Number.isNaN(value)) {
      this.mix32(0x00000000);
      this.mix32(0x7ff80000);
      return this;
    }
    const canonical = value === 0 ? 0 : value;
    this.view.setFloat64(0, canonical, true);
    this.mix32(this.view.getUint32(0, true));
    this.mix32(this.view.getUint32(4, true));
    return this;
  }

  writeString(value: string): this {
    this.writeUint32(value.length);
    for (let i = 0; i < value.length; i++) {
      this.mix32(value.charCodeAt(i));
    }
    return this;
  }

  writeUint8Array(values: Uint8Array): this {
    this.writeUint32(values.length);
    for (let i = 0; i < values.length; i++) {
      this.mix32(values[i]!);
    }
    return this;
  }

  writeInt16Array(values: Int16Array): this {
    this.writeUint32(values.length);
    for (let i = 0; i < values.length; i++) {
      this.mix32(values[i]!);
    }
    return this;
  }

  writeInt32Array(values: Int32Array): this {
    this.writeUint32(values.length);
    for (let i = 0; i < values.length; i++) {
      this.mix32(values[i]!);
    }
    return this;
  }

  writeFloat32Array(values: Float32Array): this {
    this.writeUint32(values.length);
    for (let i = 0; i < values.length; i++) {
      this.writeFloat32(values[i]!);
    }
    return this;
  }

  digest(): string {
    const hi = (this.h1 >>> 0).toString(16).padStart(8, '0');
    const lo = (this.h2 >>> 0).toString(16).padStart(8, '0');
    return `${hi}${lo}`;
  }

  digestUint32(): number {
    return (this.h1 ^ this.h2) >>> 0;
  }
}

export function hashConfig(config: SimConfig): string {
  const hasher = new StateHasher();

  for (const id of PRESET_ORDER) {
    const p = config.presets[id];
    hasher
      .writeString(p.id)
      .writeUint32(p.width)
      .writeUint32(p.height)
      .writeUint32(p.tribeCount)
      .writeUint32(p.startingCreaturesPerTribe)
      .writeUint32(p.minTribeSize)
      .writeUint32(p.popCapPerTribe)
      .writeUint32(p.generationLength)
      .writeFloat64(p.spawnRingRadius)
      .writeFloat64(p.spawnZoneRadius)
      .writeFloat64(p.fairnessRadius)
      .writeUint32(p.hotspotCount)
      .writeFloat64(p.hotspotRadius);
  }

  const m = config.map;
  hasher
    .writeFloat64(m.elevationScale)
    .writeUint32(m.elevationOctaves)
    .writeFloat64(m.elevationAmplitude)
    .writeFloat64(m.islandCoreLift)
    .writeFloat64(m.moistureScale)
    .writeUint32(m.moistureOctaves)
    .writeFloat64(m.fbmLacunarity)
    .writeFloat64(m.fbmGain)
    .writeFloat64(m.islandPlateauRadius)
    .writeFloat64(m.islandCoastRadius)
    .writeFloat64(m.falloffStrength)
    .writeFloat64(m.deepWaterThreshold)
    .writeFloat64(m.shallowWaterThreshold)
    .writeFloat64(m.sandThreshold)
    .writeFloat64(m.mountainThreshold)
    .writeFloat64(m.forestMoistureThreshold)
    .writeUint32(m.biomeMaxFood.length);

  for (const food of m.biomeMaxFood) {
    hasher.writeFloat64(food);
  }

  hasher
    .writeFloat64(m.hotspotMaxFood)
    .writeFloat64(m.moistureFoodBonus)
    .writeFloat64(m.spawnAngularJitter)
    .writeFloat64(m.spawnDryCoreRadius)
    .writeFloat64(m.pondDistanceRatio)
    .writeFloat64(m.pondRadius)
    .writeFloat64(m.pondAngleJitter)
    .writeFloat64(m.hotspotRingRatio)
    .writeFloat64(m.hotspotClearingRatio)
    .writeFloat64(m.hotspotMinClearingRadius)
    .writeFloat64(m.hotspotEdgeBoost)
    .writeFloat64(m.fairnessTolerance)
    .writeUint32(m.minFairnessWaterTiles)
    .writeUint32(m.targetFairnessWaterTiles)
    .writeFloat64(m.spawnCapacityMultiplier)
    .writeUint32(m.maxGenerationAttempts);

  const c = config.creature;
  hasher
    .writeFloat64(c.maxHealth)
    .writeFloat64(c.maxEnergy)
    .writeFloat64(c.maxHydration)
    .writeFloat64(c.baseEnergyDrain)
    .writeFloat64(c.baseHydrationDrain)
    .writeFloat64(c.moveEnergyCost)
    .writeFloat64(c.slowTileMoveMultiplier)
    .writeUint32(c.slowTileMoveCooldown)
    .writeFloat64(c.starvationHealthDrain)
    .writeFloat64(c.dehydrationHealthDrain)
    .writeFloat64(c.healthRegenRate)
    .writeFloat64(c.regenThresholdRatio)
    .writeFloat64(c.eatBiteSize)
    .writeFloat64(c.drinkBiteSize)
    .writeFloat64(c.attackEnergyCost)
    .writeFloat64(c.attackDamage)
    .writeFloat64(c.killEnergyFraction)
    .writeFloat64(c.shareAmount)
    .writeFloat64(c.shareEfficiency)
    .writeFloat64(c.shareNeedRatio)
    .writeFloat64(c.shareKeepRatio)
    .writeFloat64(c.maxAgeMultiplier)
    .writeFloat64(config.food.regrowthRate)
    .writeBoolean(config.climate.enabled)
    .writeUint32(config.climate.yearLength)
    .writeFloat64(config.climate.winterFraction)
    .writeFloat64(config.climate.winterRegrowthMultiplier)
    .writeUint32(config.climate.winterEventDuration)
    .writeUint32(config.climate.disasterCheckInterval)
    .writeFloat64(config.climate.droughtChance)
    .writeFloat64(config.climate.droughtRadius)
    .writeUint32(config.climate.droughtDuration)
    .writeFloat64(config.climate.floodChance)
    .writeFloat64(config.climate.floodRadius)
    .writeUint32(config.climate.floodDuration)
    .writeFloat64(config.climate.foodZoneRadius)
    .writeFloat64(config.climate.foodZoneRegrowthMultiplier)
    .writeUint32(config.climate.foodZoneMoveInterval)
    .writeUint32(config.climate.foodZoneStep)
    .writeUint32(config.territory.decayTicks)
    .writeUint32(config.territory.updateInterval)
    .writeFloat64(config.sensor.visionRadius)
    .writeFloat64(config.sensor.forestVisionMultiplier)
    .writeFloat64(config.sensor.countNormalization)
    .writeFloat64(config.sensor.foodNormalization)
    .writeFloat64(config.sensor.minVisibleFood)
    .writeBoolean(config.signals.enabled)
    .writeFloat64(config.signals.callThreshold)
    .writeFloat64(config.signals.callRadius)
    .writeFloat64(config.signals.callCost)
    .writeUint32(config.brain.hiddenNeurons)
    .writeUint32(config.brain.memoryNeurons)
    .writeString(config.brain.kind)
    .writeFloat64(config.brain.neat.addConnectionRate)
    .writeFloat64(config.brain.neat.addNodeRate)
    .writeFloat64(config.brain.neat.toggleRate)
    .writeUint32(config.brain.neat.maxHiddenNodes)
    .writeUint32(config.brain.neat.maxConnections);

  const e = config.evolution;
  hasher
    .writeFloat64(e.fitness.ticksAlive)
    .writeFloat64(e.fitness.foodEaten)
    .writeFloat64(e.fitness.waterDrunk)
    .writeFloat64(e.fitness.alliesHelped)
    .writeFloat64(e.fitness.kills)
    .writeFloat64(e.maxAlliesHelped)
    .writeString(e.selection)
    .writeFloat64(e.parentFraction)
    .writeUint32(e.tournamentSize)
    .writeUint32(e.eliteCount)
    .writeBoolean(e.crossover)
    .writeFloat64(e.mutationRate)
    .writeFloat64(e.mutationSigma)
    .writeFloat64(e.weightClamp)
    .writeFloat64(e.initialWeightRange)
    .writeFloat64(e.tribeScore.survivors)
    .writeFloat64(e.tribeScore.foodGathered)
    .writeFloat64(e.tribeScore.territory)
    .writeString(e.extinction)
    .writeUint32(e.battleRoyaleFromGeneration)
    .writeUint32(e.hallOfFameSize)
    .writeUint32(e.benchmarkInterval)
    .writeString(e.benchmarkSeed);

  return hasher.digest();
}

export function hashMap(map: Omit<WorldMap, 'hash'>): string {
  const hasher = new StateHasher();
  hasher
    .writeString(map.preset)
    .writeString(normalizeSeed(map.seed))
    .writeUint32(map.width)
    .writeUint32(map.height)
    .writeUint32(map.attempt)
    .writeUint32(map.walkableCount)
    .writeUint8Array(map.biomes)
    .writeFloat32Array(map.maxFood)
    .writeFloat32Array(map.food)
    .writeInt16Array(map.waterDx)
    .writeInt16Array(map.waterDy)
    .writeUint32(map.spawnZones.length);

  for (const zone of map.spawnZones) {
    hasher
      .writeUint32(zone.tribeId)
      .writeInt32(zone.x)
      .writeInt32(zone.y)
      .writeFloat64(zone.radius)
      .writeUint32(zone.walkableCount)
      .writeFloat64(zone.foodInFairnessRadius)
      .writeUint32(zone.waterInFairnessRadius);
  }

  hasher.writeUint32(map.hotspots.length);
  for (const spot of map.hotspots) {
    hasher.writeInt32(spot.x).writeInt32(spot.y).writeFloat64(spot.radius);
  }

  return hasher.digest();
}

/**
 * Full world state: `hashWorldState` plus the config hash and every creature's genome, memory and
 * calls. Same hash = same world, bit for bit (determinism tests, golden hashes, replays).
 */
export function hashWorld(world: World): string {
  const hasher = new StateHasher();
  hasher.writeString(hashConfig(world.config));
  writeWorldState(hasher, world);
  for (const c of world.creatures) {
    hasher
      .writeFloat32Array(c.genome)
      .writeFloat32Array(c.memory)
      .writeFloat64(c.call)
      .writeFloat64(c.nextCall);
  }
  return hasher.digest();
}

/**
 * What happens in the world, without how the brains are built: everything `hashWorld` covers
 * except the config hash and the creatures' genomes, memory values and calls (Sprint 4.3: what
 * the brain produces, not what happens). Two worlds whose brains differ only in layout (e.g. a
 * genome and its migration, Sprints 3.5 and 4.3) have the same state hash
 * exactly when they put the same creatures in the same places with the same stats, food and RNG
 * draws.
 */
export function hashWorldState(world: World): string {
  const hasher = new StateHasher();
  writeWorldState(hasher, world);
  return hasher.digest();
}

/** Climate state (Sprint 7.2): events in progress, spectator winter, food zone. */
function writeClimate(hasher: StateHasher, world: World): void {
  const climate = world.climate;
  const events = climate.activeEvents();
  hasher.writeUint32(events.length);
  for (const e of events) {
    hasher
      .writeUint32(e.id)
      .writeString(e.kind)
      .writeInt32(e.x)
      .writeInt32(e.y)
      .writeFloat64(e.radius)
      .writeUint32(e.endTick);
  }
  hasher.writeUint32(climate.nextEventIdForHash()).writeUint32(climate.spectatorWinterUntil());
  const zone = climate.foodZone();
  hasher
    .writeBoolean(zone !== null)
    .writeInt32(zone?.x ?? 0)
    .writeInt32(zone?.y ?? 0);
}

function writeWorldState(hasher: StateHasher, world: World): void {
  hasher
    .writeUint32(SIM_VERSION)
    .writeString(world.preset)
    .writeString(normalizeSeed(world.seed))
    .writeUint32(world.maxAge)
    .writeUint32(world.tickCount)
    .writeUint32(world.generation)
    .writeUint32(world.generationTick)
    .writeUint32(world.livingCount)
    .writeString(world.map.hash)
    .writeFloat32Array(world.map.food)
    .writeUint8Array(world.map.biomes)
    .writeInt16Array(world.territoryOwner)
    .writeInt32Array(world.territoryStamp);
  const territory = world.territoryTally();
  hasher.writeUint32(territory.recounts).writeUint32(territory.last.length);
  for (const pct of territory.last) {
    hasher.writeFloat64(pct);
  }
  hasher.writeUint32(territory.sum.length);
  for (const sum of territory.sum) {
    hasher.writeFloat64(sum);
  }

  for (const state of [
    world.rng.spawn.getState(),
    world.rng.evolution.getState(),
    world.rng.tick.getState(),
    world.rng.policy.getState(),
    world.rng.climate.getState(),
  ]) {
    hasher.writeUint32(state[0]).writeUint32(state[1]).writeUint32(state[2]).writeUint32(state[3]);
  }

  writeClimate(hasher, world);

  hasher.writeUint32(world.creatures.length);
  for (const c of world.creatures) {
    hasher
      .writeUint32(c.id)
      .writeUint32(c.tribeId)
      .writeInt32(c.x)
      .writeInt32(c.y)
      .writeInt32(c.prevX)
      .writeInt32(c.prevY)
      .writeInt32(c.lastMoveDir)
      .writeFloat64(c.health)
      .writeFloat64(c.energy)
      .writeFloat64(c.hydration)
      .writeUint32(c.age)
      .writeBoolean(c.alive)
      .writeUint32(c.moveCooldown)
      .writeUint32(c.intent)
      .writeUint32(c.lastAction)
      .writeUint32(c.stats.ticksAlive)
      .writeFloat64(c.stats.foodEaten)
      .writeFloat64(c.stats.waterDrunk)
      .writeUint32(c.stats.kills)
      .writeFloat64(c.stats.alliesHelped)
      .writeUint32(c.stats.callsMade);
  }
}
