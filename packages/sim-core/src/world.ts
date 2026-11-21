import { Action, ACTION_COUNT, applyAction, type ActionWorldContext } from './actions.js';
import { DEFAULT_CONFIG, type MapPresetId, type SimConfig } from './config.js';
import { applyMetabolism, createCreature, EMPTY_GENOME, type Creature } from './creature.js';
import { hashWorld } from './hash.js';
import { floodFillWalkable, generateMap } from './map/generator.js';
import { isWalkable, type WorldMap } from './map/types.js';
import { createRngStreams, type RngStream, type RngStreams, type Seed } from './rng.js';
import { SpatialGrid } from './spatial-grid.js';

export const NO_CREATURE = -1;

/**
 * Policy callback evaluated in Phase A for every living creature. `rng` is the dedicated
 * `world.rng.policy` stream, never the tick stream, so a policy's draws cannot change the
 * Phase B shuffle (CLAUDE.md: never share one stream between systems). Phase 3
 * neural-network policies are pure functions of creature sensors and ignore it.
 */
export type DecisionPolicy = (world: World, creature: Creature, rng: RngStream) => Action;

export function randomActionPolicy(_world: World, _creature: Creature, rng: RngStream): Action {
  return rng.nextInt(0, ACTION_COUNT) as Action;
}

export interface CreateWorldOptions {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly config?: SimConfig;
  readonly policy?: DecisionPolicy;
  readonly map?: WorldMap;
  readonly populate?: boolean;
  readonly maxAge?: number;
}

/** One tribe's creatures for a new generation: one creature per genome, in this order. */
export interface TribeSpawn {
  readonly tribeId: number;
  readonly genomes: readonly Float32Array[];
}

export class World implements ActionWorldContext {
  readonly seed: Seed;
  readonly preset: MapPresetId;
  readonly config: SimConfig;
  readonly map: WorldMap;
  readonly rng: RngStreams;
  readonly occupancy: Int32Array;
  readonly creatures: Creature[] = [];
  readonly grid: SpatialGrid;
  readonly maxAge: number;

  tickCount = 0;
  generation = 1;
  /** Ticks since the current generation started (plan §2.5). */
  generationTick = 0;
  livingCount = 0;

  private readonly policy: DecisionPolicy;
  private readonly depletedTiles: Int32Array;
  private readonly isDepleted: Uint8Array;
  private readonly livingBuffer: Creature[] = [];
  private depletedCount = 0;
  private nextCreatureId = 0;
  private gridDirty = true;
  /** Per tribe: tiles inside its spawn zone reachable from the zone centre (static terrain). */
  private readonly zoneTiles = new Map<number, Int32Array>();

  constructor(options: CreateWorldOptions) {
    this.seed = options.seed;
    this.preset = options.preset;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.policy = options.policy ?? randomActionPolicy;
    this.rng = createRngStreams(options.seed);
    // Isolate per-world mutable food buffer while sharing immutable terrain arrays zero-copy.
    this.map =
      options.map !== undefined
        ? { ...options.map, food: new Float32Array(options.map.food) }
        : generateMap({
            preset: options.preset,
            seed: options.seed,
            config: this.config,
          });

    const presetCfg = this.config.presets[this.preset];
    this.maxAge =
      options.maxAge ?? presetCfg.generationLength * this.config.creature.maxAgeMultiplier;

    const tileCount = this.map.width * this.map.height;
    this.occupancy = new Int32Array(tileCount).fill(NO_CREATURE);
    this.grid = new SpatialGrid(
      this.map.width,
      this.map.height,
      Math.max(1, Math.floor(this.config.sensor.visionRadius)),
    );
    this.depletedTiles = new Int32Array(tileCount);
    this.isDepleted = new Uint8Array(tileCount);

    // Seed active list with any tiles that start depleted (e.g. hand-made test maps).
    for (let i = 0; i < tileCount; i++) {
      if (this.map.food[i]! < this.map.maxFood[i]!) {
        this.isDepleted[i] = 1;
        this.depletedTiles[this.depletedCount] = i;
        this.depletedCount++;
      }
    }

    if (options.populate ?? true) {
      this.spawnInitialTribes();
    }
  }

  getDepletedTileCount(): number {
    return this.depletedCount;
  }

  private inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      x < this.map.width &&
      y >= 0 &&
      y < this.map.height
    );
  }

  isTileEmpty(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) {
      return false;
    }
    return this.occupancy[y * this.map.width + x] === NO_CREATURE;
  }

  getTileFood(x: number, y: number): number {
    if (!this.inBounds(x, y)) {
      return 0;
    }
    return this.map.food[y * this.map.width + x]!;
  }

  consumeFood(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y) || !(amount > 0) || !Number.isFinite(amount)) {
      return 0;
    }
    const idx = y * this.map.width + x;
    const available = this.map.food[idx]!;
    if (available <= 0) {
      return 0;
    }

    const requested = Math.min(available, amount);
    // Round to Float32 before computing actualTaken so food conservation matches Float32Array storage.
    const stored = Math.fround(Math.max(0, available - requested));
    const actualTaken = available - stored;
    if (actualTaken <= 0) {
      return 0;
    }

    this.map.food[idx] = stored;
    if (stored < this.map.maxFood[idx]! && this.isDepleted[idx] === 0) {
      this.isDepleted[idx] = 1;
      this.depletedTiles[this.depletedCount] = idx;
      this.depletedCount++;
    }
    return actualTaken;
  }

  regrowResources(): void {
    const rate = this.config.food.regrowthRate;
    if (!(rate > 0) || !Number.isFinite(rate) || this.depletedCount === 0) {
      return;
    }

    let i = 0;
    while (i < this.depletedCount) {
      const idx = this.depletedTiles[i]!;
      const current = this.map.food[idx]!;
      const max = this.map.maxFood[idx]!;
      let next = Math.fround(Math.min(max, current + rate));
      // Prevent Float32 ULP stall if rate is smaller than half an ULP at high maxFood.
      if (next <= current && current < max) {
        next = max;
      }
      this.map.food[idx] = next;

      if (next >= max) {
        this.isDepleted[idx] = 0;
        this.depletedCount--;
        this.depletedTiles[i] = this.depletedTiles[this.depletedCount]!;
      } else {
        i++;
      }
    }
  }

  spawnCreature(
    tribeId: number,
    x: number,
    y: number,
    genome: Float32Array = EMPTY_GENOME,
  ): Creature | null {
    if (!this.inBounds(x, y)) {
      return null;
    }
    const idx = y * this.map.width + x;
    if (!isWalkable(this.map.biomes[idx]!) || this.occupancy[idx] !== NO_CREATURE) {
      return null;
    }

    const creature = createCreature(
      this.nextCreatureId,
      tribeId,
      x,
      y,
      this.config.creature,
      genome,
    );
    this.nextCreatureId++;
    this.occupancy[idx] = creature.id;
    this.creatures.push(creature);
    this.livingCount++;
    this.gridDirty = true;
    return creature;
  }

  rebuildGrid(): void {
    this.grid.rebuild(this.creatures);
    this.gridDirty = false;
  }

  ensureGrid(): SpatialGrid {
    if (this.gridDirty) {
      this.rebuildGrid();
    }
    return this.grid;
  }

  moveCreature(creature: Creature, nx: number, ny: number, dir: Action): void {
    if (!creature.alive) {
      throw new RangeError(`Cannot move dead creature ${creature.id}`);
    }
    if (!this.inBounds(nx, ny)) {
      throw new RangeError(`Target (${nx}, ${ny}) is out of bounds`);
    }
    const oldIdx = creature.y * this.map.width + creature.x;
    const newIdx = ny * this.map.width + nx;
    if (this.occupancy[oldIdx] !== creature.id) {
      throw new RangeError(`Creature ${creature.id} is not at (${creature.x}, ${creature.y})`);
    }
    if (!isWalkable(this.map.biomes[newIdx]!)) {
      throw new RangeError(`Target (${nx}, ${ny}) is not walkable`);
    }
    if (this.occupancy[newIdx] !== NO_CREATURE) {
      throw new RangeError(`Target (${nx}, ${ny}) is already occupied`);
    }

    this.occupancy[oldIdx] = NO_CREATURE;
    this.occupancy[newIdx] = creature.id;
    creature.x = nx;
    creature.y = ny;
    creature.lastMoveDir = dir;
    this.gridDirty = true;
  }

  /**
   * Advances the simulation by one deterministic two-phase tick (plan §3.4).
   */
  tick(): void {
    this.regrowResources();
    this.rebuildGrid();

    const living = this.livingBuffer;
    living.length = 0;

    // Phase A — sense & decide in ascending id order against a consistent world state.
    for (const creature of this.creatures) {
      if (!creature.alive) continue;
      creature.prevX = creature.x;
      creature.prevY = creature.y;
      creature.intent = this.policy(this, creature, this.rng.policy);
      living.push(creature);
    }

    // Phase B — resolve actions in a seeded per-tick shuffled order (no permanent id advantage).
    this.rng.tick.shuffle(living);
    for (const creature of living) {
      if (!creature.alive) continue;
      creature.lastAction = applyAction(this, creature, creature.intent);
    }
    living.length = 0;

    // Metabolism & death in ascending id order.
    for (const creature of this.creatures) {
      if (!creature.alive) continue;
      const died = applyMetabolism(creature, this.config.creature, this.maxAge);
      if (died) {
        this.occupancy[creature.y * this.map.width + creature.x] = NO_CREATURE;
        this.livingCount--;
        this.gridDirty = true;
      }
    }

    this.tickCount++;
    this.generationTick++;
  }

  hash(): string {
    return hashWorld(this);
  }

  /**
   * True once the generation has run `generationLength` ticks or every creature is dead
   * (plan §2.5). Battle royale's "one tribe left" rule lives in the evolution driver.
   */
  isGenerationOver(): boolean {
    return (
      this.generationTick >= this.config.presets[this.preset].generationLength ||
      this.livingCount === 0
    );
  }

  /**
   * World reset at generation start (plan §2.5): food back to full, all creatures removed, then
   * each tribe's creatures spawned at seeded random tiles of its start zone, one per genome.
   * Creature ids restart at 0, so `creatures[id]` is always the creature with that id.
   */
  startGeneration(generation: number, spawns: readonly TribeSpawn[]): void {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new RangeError(`generation must be a positive integer, got ${generation}`);
    }
    const ordered = [...spawns].sort((a, b) => a.tribeId - b.tribeId);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i]!.tribeId === ordered[i - 1]!.tribeId) {
        throw new RangeError(`Tribe ${ordered[i]!.tribeId} appears twice in the spawn list`);
      }
    }

    this.map.food.set(this.map.maxFood);
    this.isDepleted.fill(0);
    this.depletedCount = 0;
    this.occupancy.fill(NO_CREATURE);
    this.creatures.length = 0;
    this.livingCount = 0;
    this.nextCreatureId = 0;
    this.gridDirty = true;
    this.generation = generation;
    this.generationTick = 0;

    for (const spawn of ordered) {
      this.spawnTribe(spawn.tribeId, spawn.genomes);
    }
  }

  private spawnInitialTribes(): void {
    const count = this.config.presets[this.preset].startingCreaturesPerTribe;
    const genomes = new Array<Float32Array>(count).fill(EMPTY_GENOME);
    for (const zone of this.map.spawnZones) {
      this.spawnTribe(zone.tribeId, genomes);
    }
  }

  private getZoneTiles(tribeId: number): Int32Array {
    const cached = this.zoneTiles.get(tribeId);
    if (cached !== undefined) {
      return cached;
    }
    const zone = this.map.spawnZones.find((z) => z.tribeId === tribeId);
    if (zone === undefined) {
      throw new RangeError(`Map has no spawn zone for tribe ${tribeId}`);
    }
    const { width, height, biomes } = this.map;
    const reachable = floodFillWalkable(biomes, width, height, zone.x, zone.y);
    const rInt = Math.ceil(zone.radius);
    const r2 = zone.radius * zone.radius;
    const minX = Math.max(0, zone.x - rInt);
    const maxX = Math.min(width - 1, zone.x + rInt);
    const minY = Math.max(0, zone.y - rInt);
    const maxY = Math.min(height - 1, zone.y + rInt);

    const tiles: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      const dy = y - zone.y;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - zone.x;
        if (dx * dx + dy * dy > r2) continue;
        const idx = y * width + x;
        if (reachable[idx] === 1) {
          tiles.push(idx);
        }
      }
    }
    const built = Int32Array.from(tiles);
    this.zoneTiles.set(tribeId, built);
    return built;
  }

  /** Spawns one creature per genome at shuffled free tiles of the tribe's zone (`rng.spawn`). */
  private spawnTribe(tribeId: number, genomes: readonly Float32Array[]): void {
    if (genomes.length === 0) {
      return;
    }
    const width = this.map.width;
    const candidates: number[] = [];
    for (const idx of this.getZoneTiles(tribeId)) {
      if (this.occupancy[idx] === NO_CREATURE) {
        candidates.push(idx);
      }
    }

    this.rng.spawn.shuffle(candidates);

    let spawned = 0;
    for (const idx of candidates) {
      if (spawned >= genomes.length) break;
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      if (this.spawnCreature(tribeId, x, y, genomes[spawned]) !== null) {
        spawned++;
      }
    }

    if (spawned < genomes.length) {
      throw new Error(
        `Spawn zone for tribe ${tribeId} only fit ${spawned}/${genomes.length} creatures`,
      );
    }
  }
}

export function createWorld(options: CreateWorldOptions): World {
  return new World(options);
}
