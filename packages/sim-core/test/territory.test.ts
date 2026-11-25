// Sprint 4.1: territory ownership with decay and territory % (plan §2.6, §3.4).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Action,
  Biome,
  createEvolutionRun,
  createWorld,
  DEFAULT_CONFIG,
  hashWorld,
  hashWorldState,
  NO_OWNER,
  randomActionPolicy,
  tribeOutcome,
  tribeScore,
  type DecisionPolicy,
  type SimConfig,
  type World,
} from '../src/index.js';
import { makeMiniMap } from './mini-map.js';

function territoryConfig(decayTicks: number, updateInterval: number): SimConfig {
  return { ...DEFAULT_CONFIG, territory: { decayTicks, updateInterval } };
}

function strip(width: number, policy: DecisionPolicy, config: SimConfig): World {
  const map = makeMiniMap([new Array<Biome>(width).fill(Biome.Grass)]);
  return createWorld({ preset: 'small', seed: 'territory', map, populate: false, policy, config });
}

function owned(world: World, tribeId: number): number {
  return world.territoryOwner.reduce((acc, owner) => acc + (owner === tribeId ? 1 : 0), 0);
}

describe('territory (plan §2.6)', () => {
  it('belongs to the tribe standing on a tile; % = owned ÷ walkable tiles', () => {
    const world = strip(10, () => Action.STAY, territoryConfig(300, 1));
    world.spawnCreature(0, 0, 0);
    world.spawnCreature(1, 5, 0);
    world.spawnCreature(1, 9, 0);
    world.tick();
    expect(world.territoryOwner[0]).toBe(0);
    expect(world.territoryOwner[5]).toBe(1);
    expect(world.territoryOwner[1]).toBe(NO_OWNER);
    expect(world.territoryPercent(0)).toBe(10);
    expect(world.territoryPercent(1)).toBe(20);
    expect(world.territoryPercent(7)).toBe(0);
  });

  it('fades without a visit: a walker owns only its last decayTicks tiles, not its trail', () => {
    const decay = 5;
    const world = strip(40, () => Action.MOVE_E, territoryConfig(decay, 1));
    world.spawnCreature(0, 0, 0);
    for (let t = 0; t < 30; t++) world.tick();
    // It walked 30 tiles; only the tiles stamped within the last `decay` ticks are still owned.
    expect(owned(world, 0)).toBe(decay + 1);
    expect(world.territoryPercent(0)).toBe((100 * (decay + 1)) / 40);
  });

  it('stays owned while a creature keeps standing there', () => {
    const world = strip(3, () => Action.STAY, territoryConfig(5, 1));
    world.spawnCreature(0, 1, 0);
    for (let t = 0; t < 100; t++) world.tick();
    expect(owned(world, 0)).toBe(1);
  });

  it('is recounted only every updateInterval ticks', () => {
    const world = strip(10, () => Action.MOVE_E, territoryConfig(300, 4));
    world.spawnCreature(0, 0, 0);
    world.tick(); // generation tick 0: recount (2 tiles: spawn + first step)
    expect(world.territoryPercent(0)).toBe(20);
    world.tick();
    world.tick();
    world.tick();
    expect(world.territoryPercent(0)).toBe(20); // 3 more steps, not recounted yet
    world.tick(); // generation tick 4: recount
    expect(world.territoryPercent(0)).toBe(60);
  });

  it('is cleared at generation start', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 9 });
    run.tick();
    const world = run.world;
    expect(world.territoryOwner.some((o) => o !== NO_OWNER)).toBe(true);
    expect(world.territoryPercent(0)).toBeGreaterThan(0);
    run.runGeneration();
    // Only the new generation's spawn tiles are owned right after the reset.
    expect(world.generationTick).toBe(0);
    expect(world.territoryPercent(0)).toBe(0);
    const ownedTiles = world.territoryOwner.filter((o) => o !== NO_OWNER).length;
    expect(ownedTiles).toBe(world.livingCount);
  });

  it('adds up to ≤ 100 % over all tribes, each within 0..100, for random worlds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 1, max: 20 }),
        (seed, decay, interval) => {
          const world = createWorld({
            preset: 'small',
            seed,
            policy: randomActionPolicy,
            config: territoryConfig(decay, interval),
          });
          for (let t = 0; t < 150; t++) {
            world.tick();
            let sum = 0;
            for (const zone of world.map.spawnZones) {
              const pct = world.territoryPercent(zone.tribeId);
              expect(pct).toBeGreaterThanOrEqual(0);
              expect(pct).toBeLessThanOrEqual(100);
              sum += pct;
            }
            expect(sum).toBeLessThanOrEqual(100 + 1e-9);
          }
        },
      ),
      { numRuns: 12 },
    );
  });

  it('is part of the world state hash', () => {
    const world = createWorld({ preset: 'small', seed: 4 });
    world.tick();
    const full = hashWorld(world);
    const state = hashWorldState(world);
    const tile = world.territoryOwner.findIndex((o) => o === NO_OWNER);
    world.territoryOwner[tile] = 1;
    expect(hashWorld(world)).not.toBe(full);
    expect(hashWorldState(world)).not.toBe(state);
  });
});

describe('territory in the tribe outcome and generation stats', () => {
  it('feeds tribeOutcome and the tribe score with its weight', () => {
    const outcome = tribeOutcome([], 12.5);
    expect(outcome.territoryPct).toBe(12.5);
    const evolution = {
      ...DEFAULT_CONFIG.evolution,
      tribeScore: { survivors: 0, foodGathered: 0, territory: 2 },
    };
    expect(tribeScore(outcome, evolution)).toBe(25);
    // Default weight 0 until Sprint 4.2 tunes it.
    expect(tribeScore(outcome, DEFAULT_CONFIG.evolution)).toBe(0);
  });

  it("is recorded in each generation's stats", () => {
    const run = createEvolutionRun({ preset: 'small', seed: 9 });
    // Read the world's territory % at the end of generation 1, just before the reset.
    const world = run.world;
    const reset = world.startGeneration.bind(world);
    let atEnd: number[] = [];
    world.startGeneration = (generation, spawns) => {
      atEnd = run.tribes.map((t) => world.territoryPercent(t.id));
      reset(generation, spawns);
    };
    run.runGeneration();
    const recorded = run.tribes.map((t) => t.history[0]!.territoryPct);
    expect(recorded).toEqual(atEnd);
    expect(recorded.some((pct) => pct > 0)).toBe(true);
  });
});
