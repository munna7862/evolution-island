import type { ClimateConfig } from './config.js';
import { Biome } from './map/types.js';
import type { RngStream } from './rng.js';

/**
 * Climate & disasters (plan §4 Sprint 7.2): winter, droughts, floods and a wandering food zone,
 * natural (drawn from the `climate` RNG stream when `climate.enabled`) or dropped by a spectator.
 * Everything is undone at each generation start: every generation begins on the map as generated.
 */

/** What a spectator can drop on the world (plan §3.3 "spectator input"). */
export const WORLD_EVENT_KINDS = ['drought', 'flood', 'winter', 'foodZone'] as const;
export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number];

/** A world event: where it happens (ignored for winter, which is everywhere). */
export interface WorldEvent {
  readonly kind: WorldEventKind;
  readonly x: number;
  readonly y: number;
}

/** A drought or flood in progress: it changes terrain within `radius` until `endTick`. */
export interface TerrainEvent {
  /** Start order: overlapping events apply oldest first. */
  readonly id: number;
  readonly kind: 'drought' | 'flood';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Generation tick at which it ends (the terrain is restored before that tick). */
  readonly endTick: number;
}

/** What the climate changes: the world's live terrain and food, and the map as generated. */
export interface ClimateTerrain {
  readonly width: number;
  readonly height: number;
  readonly biomes: Uint8Array;
  readonly maxFood: Float32Array;
  readonly food: Float32Array;
  readonly baseBiomes: Uint8Array;
  readonly baseMaxFood: Float32Array;
  readonly biomeMaxFood: readonly number[];
  /** A tile's food or maximum changed (the world puts it on the regrowth list if needed). */
  foodChanged(idx: number): void;
  /** Biomes changed: recompute the water field. */
  waterChanged(): void;
}

/** Eight directions, in a fixed order, for the food zone's moves. */
const STEP_DX = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const STEP_DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const;

function isLand(biome: number): boolean {
  return biome === Biome.Sand || biome === Biome.Grass || biome === Biome.Forest;
}

export class Climate {
  private events: TerrainEvent[] = [];
  private nextEventId = 0;
  /** Spectator winter: winter while the generation tick is below this. */
  private winterUntil = 0;
  private zone: { x: number; y: number } | null = null;
  /** Tiles where natural events may centre (from the map as generated, built once). */
  private landTiles: Int32Array | null = null;
  private shallowTiles: Int32Array | null = null;

  constructor(
    private readonly config: ClimateConfig,
    private readonly terrain: ClimateTerrain,
  ) {}

  /** Generation start: terrain back to the map as generated; a new food zone if enabled. */
  reset(rng: RngStream): void {
    const hadEvents = this.events.length > 0;
    const old = this.events;
    this.events = [];
    for (const e of old) this.refreshArea(e);
    if (hadEvents) this.terrain.waterChanged();
    this.nextEventId = 0;
    this.winterUntil = 0;
    this.zone = null;
    if (this.config.enabled) {
      const land = this.landTileList();
      if (land.length > 0) {
        const idx = land[rng.nextInt(0, land.length)]!;
        this.zone = { x: idx % this.terrain.width, y: Math.floor(idx / this.terrain.width) };
      }
    }
  }

  /**
   * Start of a tick at `generationTick`: ended events are undone, then (if enabled) disasters may
   * start and the food zone may move — in that order, drought before flood.
   */
  beforeTick(generationTick: number, rng: RngStream): void {
    const ended = this.events.filter((e) => e.endTick <= generationTick);
    if (ended.length > 0) {
      this.events = this.events.filter((e) => e.endTick > generationTick);
      for (const e of ended) this.refreshArea(e);
      this.terrain.waterChanged();
    }
    if (!this.config.enabled || generationTick === 0) return;
    const cfg = this.config;
    if (generationTick % Math.max(1, cfg.disasterCheckInterval) === 0) {
      if (rng.nextFloat() < cfg.droughtChance) this.startNatural('drought', generationTick, rng);
      if (rng.nextFloat() < cfg.floodChance) this.startNatural('flood', generationTick, rng);
    }
    if (this.zone !== null && generationTick % Math.max(1, cfg.foodZoneMoveInterval) === 0) {
      const dir = rng.nextInt(0, 8);
      this.moveZone(
        this.zone.x + STEP_DX[dir]! * cfg.foodZoneStep,
        this.zone.y + STEP_DY[dir]! * cfg.foodZoneStep,
      );
    }
  }

  /** A spectator's event, applied between ticks; returns false if it is off the map. */
  apply(event: WorldEvent, generationTick: number): boolean {
    const { width, height } = this.terrain;
    if (event.kind === 'winter') {
      this.winterUntil = generationTick + this.config.winterEventDuration;
      return true;
    }
    if (
      !Number.isInteger(event.x) ||
      !Number.isInteger(event.y) ||
      event.x < 0 ||
      event.y < 0 ||
      event.x >= width ||
      event.y >= height
    ) {
      return false;
    }
    if (event.kind === 'foodZone') {
      this.moveZone(event.x, event.y);
      return true;
    }
    this.start(event.kind, event.x, event.y, generationTick);
    return true;
  }

  /** Whether `generationTick` is in winter (the end of a year, or a spectator's winter). */
  isWinter(generationTick: number): boolean {
    if (generationTick < this.winterUntil) return true;
    if (!this.config.enabled) return false;
    const year = Math.max(1, this.config.yearLength);
    return generationTick % year >= year * (1 - this.config.winterFraction);
  }

  /** The regrowth multiplier of every tile this tick (winter). */
  seasonMultiplier(generationTick: number): number {
    return this.isWinter(generationTick) ? this.config.winterRegrowthMultiplier : 1;
  }

  /** The food zone's extra multiplier at tile `idx` (1 outside it). */
  zoneMultiplier(idx: number): number {
    const zone = this.zone;
    if (zone === null) return 1;
    const width = this.terrain.width;
    const dx = (idx % width) - zone.x;
    const dy = Math.floor(idx / width) - zone.y;
    const r = this.config.foodZoneRadius;
    return dx * dx + dy * dy <= r * r ? this.config.foodZoneRegrowthMultiplier : 1;
  }

  /** Droughts and floods in progress, oldest first. */
  activeEvents(): readonly TerrainEvent[] {
    return this.events;
  }

  foodZone(): { readonly x: number; readonly y: number } | null {
    return this.zone;
  }

  /** The id the next drought or flood gets (hashed: it orders overlapping events). */
  nextEventIdForHash(): number {
    return this.nextEventId;
  }

  /** Generation tick until which a spectator's winter lasts (0 = none yet). */
  spectatorWinterUntil(): number {
    return this.winterUntil;
  }

  /** A natural drought (on shallow water) or flood (on land) at a random tile of its kind. */
  private startNatural(kind: 'drought' | 'flood', generationTick: number, rng: RngStream): void {
    const tiles = kind === 'drought' ? this.shallowTileList() : this.landTileList();
    if (tiles.length === 0) return;
    const idx = tiles[rng.nextInt(0, tiles.length)]!;
    const width = this.terrain.width;
    this.start(kind, idx % width, Math.floor(idx / width), generationTick);
  }

  private start(kind: 'drought' | 'flood', x: number, y: number, generationTick: number): void {
    const cfg = this.config;
    const event: TerrainEvent = {
      id: this.nextEventId++,
      kind,
      x,
      y,
      radius: kind === 'drought' ? cfg.droughtRadius : cfg.floodRadius,
      endTick: generationTick + (kind === 'drought' ? cfg.droughtDuration : cfg.floodDuration),
    };
    this.events.push(event);
    if (this.refreshArea(event)) this.terrain.waterChanged();
  }

  private moveZone(x: number, y: number): void {
    const { width, height } = this.terrain;
    this.zone = {
      x: Math.min(width - 1, Math.max(0, x)),
      y: Math.min(height - 1, Math.max(0, y)),
    };
  }

  /**
   * Recomputes every tile in `area` from the map as generated plus the events in progress (oldest
   * first: a flood turns land to shallow water, a drought shallow water to sand). Returns whether
   * any biome changed.
   */
  private refreshArea(area: { x: number; y: number; radius: number }): boolean {
    const t = this.terrain;
    const r = Math.max(0, area.radius);
    const reach = Math.floor(r);
    let changed = false;
    for (let y = Math.max(0, area.y - reach); y <= Math.min(t.height - 1, area.y + reach); y++) {
      for (let x = Math.max(0, area.x - reach); x <= Math.min(t.width - 1, area.x + reach); x++) {
        const ax = x - area.x;
        const ay = y - area.y;
        if (ax * ax + ay * ay > r * r) continue;
        const idx = y * t.width + x;
        const biome = this.biomeAt(x, y, t.baseBiomes[idx]!);
        if (biome === t.biomes[idx]) continue;
        changed = true;
        t.biomes[idx] = biome;
        t.maxFood[idx] = biome === t.baseBiomes[idx] ? t.baseMaxFood[idx]! : t.biomeMaxFood[biome]!;
        if (t.food[idx]! > t.maxFood[idx]) t.food[idx] = t.maxFood[idx];
        t.foodChanged(idx);
      }
    }
    return changed;
  }

  private biomeAt(x: number, y: number, base: number): number {
    let biome = base;
    for (const e of this.events) {
      const dx = x - e.x;
      const dy = y - e.y;
      if (dx * dx + dy * dy > e.radius * e.radius) continue;
      if (e.kind === 'flood' && isLand(biome)) biome = Biome.ShallowWater;
      else if (e.kind === 'drought' && biome === Biome.ShallowWater) biome = Biome.Sand;
    }
    return biome;
  }

  private landTileList(): Int32Array {
    this.landTiles ??= this.tilesWhere(isLand);
    return this.landTiles;
  }

  private shallowTileList(): Int32Array {
    this.shallowTiles ??= this.tilesWhere((b) => b === Biome.ShallowWater);
    return this.shallowTiles;
  }

  private tilesWhere(test: (biome: number) => boolean): Int32Array {
    const base = this.terrain.baseBiomes;
    const out: number[] = [];
    for (let i = 0; i < base.length; i++) if (test(base[i]!)) out.push(i);
    return Int32Array.from(out);
  }
}
