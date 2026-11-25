import { describe, expect, it } from 'vitest';
import {
  Action,
  Biome,
  computeWaterField,
  createEvolutionRun,
  createWorld,
  DEFAULT_CONFIG,
  type ClimateConfig,
  type DecisionPolicy,
  type SimConfig,
  type World,
} from '../src/index.js';
import { arenaConfig } from '../src/benchmark.js';
import { makeMiniMap } from './mini-map.js';

/** Climate & disasters (plan §4 Sprint 7.2): one test per event, plus the shared rules. */

function withClimate(patch: Partial<ClimateConfig>): SimConfig {
  return { ...DEFAULT_CONFIG, climate: { ...DEFAULT_CONFIG.climate, ...patch } };
}

/** Natural climate off: only what a test triggers happens. */
const QUIET = withClimate({ enabled: false });

/** A 21 × 21 map: grass with a 5 × 5 pond of shallow water in the middle. */
function pondMap() {
  const grid: Biome[][] = [];
  for (let y = 0; y < 21; y++) {
    const row: Biome[] = [];
    for (let x = 0; x < 21; x++) {
      row.push(Math.abs(x - 10) <= 2 && Math.abs(y - 10) <= 2 ? Biome.ShallowWater : Biome.Grass);
    }
    grid.push(row);
  }
  return makeMiniMap(grid, 60);
}

function pondWorld(config: SimConfig = QUIET, policy: DecisionPolicy = () => Action.STAY): World {
  return createWorld({ preset: 'small', seed: 1, map: pondMap(), populate: false, config, policy });
}

const at = (world: World, x: number, y: number): number => y * world.map.width + x;

function ticks(world: World, n: number): void {
  for (let i = 0; i < n; i++) world.tick();
}

function expectWaterFieldMatchesTerrain(world: World): void {
  const field = computeWaterField(world.map.biomes, world.map.width, world.map.height);
  expect(Array.from(world.map.waterDx)).toEqual(Array.from(field.dx));
  expect(Array.from(world.map.waterDy)).toEqual(Array.from(field.dy));
}

describe('winter', () => {
  it('is the last winterFraction of every year, and slows regrowth by its multiplier', () => {
    const config = withClimate({ yearLength: 100, winterFraction: 0.25 });
    const world = pondWorld(config);
    expect(world.climate.isWinter(74)).toBe(false);
    expect(world.climate.isWinter(75)).toBe(true);
    expect(world.climate.isWinter(99)).toBe(true);
    expect(world.climate.isWinter(100)).toBe(false);
    expect(world.climate.seasonMultiplier(80)).toBe(config.climate.winterRegrowthMultiplier);
    expect(world.climate.seasonMultiplier(10)).toBe(1);
  });

  it('a spectator winter lasts winterEventDuration ticks, even with natural climate off', () => {
    const world = pondWorld();
    const tile = at(world, 0, 0);
    world.consumeFood(0, 0, 60);
    ticks(world, 10);
    const summer = world.map.food[tile]!;
    expect(world.applyWorldEvent({ kind: 'winter', x: 0, y: 0 })).toBe(true);
    ticks(world, 10);
    const winterGain = world.map.food[tile]! - summer;
    const rate = DEFAULT_CONFIG.food.regrowthRate;
    expect(summer).toBeCloseTo(10 * rate, 4);
    expect(winterGain).toBeCloseTo(10 * rate * QUIET.climate.winterRegrowthMultiplier, 4);
    expect(world.climate.isWinter(10 + QUIET.climate.winterEventDuration - 1)).toBe(true);
    expect(world.climate.isWinter(10 + QUIET.climate.winterEventDuration)).toBe(false);
  });
});

describe('drought', () => {
  it('dries shallow water within its radius to sand, recomputes the water field, then ends', () => {
    const config = withClimate({ enabled: false, droughtRadius: 1.5, droughtDuration: 20 });
    const world = pondWorld(config);
    expect(world.applyWorldEvent({ kind: 'drought', x: 10, y: 10 })).toBe(true);
    expect(world.map.biomes[at(world, 10, 10)]).toBe(Biome.Sand);
    expect(world.map.biomes[at(world, 11, 11)]).toBe(Biome.Sand); // √2 ≤ 1.5
    expect(world.map.biomes[at(world, 12, 10)]).toBe(Biome.ShallowWater); // 2 > 1.5
    expect(world.map.biomes[at(world, 5, 5)]).toBe(Biome.Grass); // land is untouched
    // Sand gets its biome's food maximum; it starts empty and regrows.
    expect(world.map.maxFood[at(world, 10, 10)]).toBe(DEFAULT_CONFIG.map.biomeMaxFood[Biome.Sand]);
    expect(world.map.food[at(world, 10, 10)]).toBe(0);
    expectWaterFieldMatchesTerrain(world);
    ticks(world, 1);
    expect(world.map.food[at(world, 10, 10)]).toBeGreaterThan(0);

    ticks(world, 19);
    expect(world.map.biomes[at(world, 10, 10)]).toBe(Biome.Sand);
    ticks(world, 1); // generation tick 20 = endTick: restored before it
    expect(world.map.biomes[at(world, 10, 10)]).toBe(Biome.ShallowWater);
    expect(world.map.maxFood[at(world, 10, 10)]).toBe(0);
    expect(world.map.food[at(world, 10, 10)]).toBe(0);
    expect(world.climate.activeEvents()).toEqual([]);
    expectWaterFieldMatchesTerrain(world);
  });
});

describe('flood', () => {
  it('turns land within its radius into shallow water (food lost), then the land comes back', () => {
    const config = withClimate({ enabled: false, floodRadius: 2, floodDuration: 30 });
    const world = pondWorld(config);
    const creature = world.spawnCreature(0, 3, 3)!;
    expect(world.applyWorldEvent({ kind: 'flood', x: 3, y: 3 })).toBe(true);
    expect(world.map.biomes[at(world, 3, 3)]).toBe(Biome.ShallowWater);
    expect(world.map.biomes[at(world, 5, 3)]).toBe(Biome.ShallowWater);
    expect(world.map.biomes[at(world, 6, 3)]).toBe(Biome.Grass);
    expect(world.map.food[at(world, 3, 3)]).toBe(0);
    expect(world.map.maxFood[at(world, 3, 3)]).toBe(0);
    expectWaterFieldMatchesTerrain(world);
    // Shallow water is walkable: the creature stays where it is and can drink there.
    ticks(world, 1);
    expect(creature.alive).toBe(true);
    expect(world.occupancy[at(world, 3, 3)]).toBe(creature.id);

    ticks(world, 29); // generation ticks 1..29: still flooded
    expect(world.map.biomes[at(world, 3, 3)]).toBe(Biome.ShallowWater);
    ticks(world, 1); // generation tick 30 = endTick: the land comes back, then regrows from nothing
    expect(world.map.biomes[at(world, 3, 3)]).toBe(Biome.Grass);
    expect(world.map.maxFood[at(world, 3, 3)]).toBe(60);
    expect(world.map.food[at(world, 3, 3)]).toBeCloseTo(DEFAULT_CONFIG.food.regrowthRate, 5);
    expectWaterFieldMatchesTerrain(world);
  });

  it('overlapping events apply oldest first: a drought after a flood dries the flooded land', () => {
    const config = withClimate({ enabled: false, floodRadius: 1, droughtRadius: 1 });
    const world = pondWorld(config);
    world.applyWorldEvent({ kind: 'flood', x: 3, y: 3 });
    world.applyWorldEvent({ kind: 'drought', x: 3, y: 3 });
    expect(world.map.biomes[at(world, 3, 3)]).toBe(Biome.Sand);
    const reversed = pondWorld(config);
    reversed.applyWorldEvent({ kind: 'drought', x: 3, y: 3 });
    reversed.applyWorldEvent({ kind: 'flood', x: 3, y: 3 });
    expect(reversed.map.biomes[at(reversed, 3, 3)]).toBe(Biome.ShallowWater);
  });
});

describe('food zone', () => {
  it('regrows food faster inside its radius; a spectator can move it', () => {
    const config = withClimate({
      enabled: false,
      foodZoneRadius: 2,
      foodZoneRegrowthMultiplier: 3,
    });
    const world = pondWorld(config);
    expect(world.climate.foodZone()).toBeNull();
    expect(world.applyWorldEvent({ kind: 'foodZone', x: 2, y: 2 })).toBe(true);
    expect(world.climate.foodZone()).toEqual({ x: 2, y: 2 });
    world.consumeFood(2, 2, 60);
    world.consumeFood(18, 18, 60);
    ticks(world, 10);
    const rate = DEFAULT_CONFIG.food.regrowthRate;
    expect(world.map.food[at(world, 2, 2)]).toBeCloseTo(10 * rate * 3, 4);
    expect(world.map.food[at(world, 18, 18)]).toBeCloseTo(10 * rate, 4);
  });

  it('with climate on it starts on land and moves foodZoneStep tiles every foodZoneMoveInterval', () => {
    const config = withClimate({
      enabled: true,
      droughtChance: 0,
      floodChance: 0,
      foodZoneMoveInterval: 10,
      foodZoneStep: 3,
    });
    const world = pondWorld(config);
    const start = world.climate.foodZone()!;
    expect(world.map.biomes[at(world, start.x, start.y)]).toBe(Biome.Grass);
    ticks(world, 10);
    expect(world.climate.foodZone()).toEqual(start); // moves at the start of generation tick 10
    ticks(world, 1);
    const moved = world.climate.foodZone()!;
    const dx = Math.abs(moved.x - start.x);
    const dy = Math.abs(moved.y - start.y);
    // One of 8 directions, 3 tiles, clamped to the map.
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(3);
    expect(dx + dy).toBeGreaterThan(0);
  });
});

describe('climate rules', () => {
  it('natural disasters come from the climate stream: same seed, same events', () => {
    const config = withClimate({ disasterCheckInterval: 50, droughtChance: 0.5, floodChance: 0.5 });
    const events = (seed: number) => {
      const world = createWorld({ preset: 'small', seed, config });
      const seen: string[] = [];
      for (let i = 0; i < 400; i++) {
        world.tick();
        for (const e of world.climate.activeEvents()) seen.push(`${e.id}:${e.kind}@${e.x},${e.y}`);
      }
      return [...new Set(seen)];
    };
    const a = events(5);
    expect(a.length).toBeGreaterThan(0);
    expect(events(5)).toEqual(a);
    expect(events(6)).not.toEqual(a);
  });

  it('with climate off nothing happens by itself', () => {
    const world = createWorld({ preset: 'small', seed: 5, config: QUIET });
    const biomes = Uint8Array.from(world.map.biomes);
    for (let i = 0; i < 1200; i++) {
      world.tick();
      expect(world.climate.activeEvents()).toEqual([]);
    }
    expect(world.climate.isWinter(world.generationTick)).toBe(false);
    expect(world.climate.foodZone()).toBeNull();
    expect(Array.from(world.map.biomes)).toEqual(Array.from(biomes));
  });

  it('refuses a place off the map and changes nothing', () => {
    const world = pondWorld();
    const before = world.hash();
    expect(world.applyWorldEvent({ kind: 'flood', x: 21, y: 0 })).toBe(false);
    expect(world.applyWorldEvent({ kind: 'drought', x: -1, y: 3 })).toBe(false);
    expect(world.applyWorldEvent({ kind: 'foodZone', x: 2.5, y: 3 })).toBe(false);
    expect(world.hash()).toBe(before);
  });

  it('a new generation starts on the map as generated', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 3 });
    const world = run.world;
    const biomes = Uint8Array.from(world.map.biomes);
    const water = Int16Array.from(world.map.waterDx);
    const land = biomes.findIndex((b) => b === Biome.Grass);
    world.applyWorldEvent({
      kind: 'flood',
      x: land % world.map.width,
      y: Math.floor(land / world.map.width),
    });
    world.applyWorldEvent({ kind: 'winter', x: 0, y: 0 });
    expect(world.map.biomes[land]).toBe(Biome.ShallowWater);
    run.runGeneration();
    expect(world.generationTick).toBe(0);
    expect(Array.from(world.map.biomes)).toEqual(Array.from(biomes));
    expect(Array.from(world.map.waterDx)).toEqual(Array.from(water));
    expect(world.climate.isWinter(0)).toBe(false);
  });

  it('never changes a map shared with other worlds', () => {
    const map = pondMap();
    const biomes = Uint8Array.from(map.biomes);
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false, config: QUIET });
    world.applyWorldEvent({ kind: 'drought', x: 10, y: 10 });
    expect(Array.from(map.biomes)).toEqual(Array.from(biomes));
    expect(world.map.biomes).not.toBe(map.biomes);
  });

  it('terrain and climate are in the world hash', () => {
    const a = pondWorld();
    const b = pondWorld();
    expect(a.hash()).toBe(b.hash());
    b.applyWorldEvent({ kind: 'winter', x: 0, y: 0 });
    expect(b.hash()).not.toBe(a.hash());
    const c = pondWorld();
    c.applyWorldEvent({ kind: 'foodZone', x: 1, y: 1 });
    expect(c.hash()).not.toBe(a.hash());
  });

  it('the benchmark arena has no natural climate (a fixed yardstick)', () => {
    expect(arenaConfig(DEFAULT_CONFIG).climate.enabled).toBe(false);
    expect(arenaConfig(QUIET)).toBe(QUIET);
  });
});
