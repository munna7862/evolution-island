// Exploit tests for every fitness and tribe-score term (CLAUDE.md, plan §2.5, §5 "Exploits").
import { describe, expect, it } from 'vitest';
import {
  Action,
  Biome,
  createWorld,
  creatureFitness,
  DEFAULT_CONFIG,
  MAP_PRESETS,
  tribeOutcome,
  tribeScore,
  type CreatureStats,
  type DecisionPolicy,
  type SimConfig,
} from '../src/index.js';
import { makeMiniMap } from './mini-map.js';

const EVO = DEFAULT_CONFIG.evolution;
const CREATURE = DEFAULT_CONFIG.creature;

function stats(partial: Partial<CreatureStats>): CreatureStats {
  return {
    ticksAlive: 0,
    foodEaten: 0,
    waterDrunk: 0,
    kills: 0,
    alliesHelped: 0,
    callsMade: 0,
    ...partial,
  };
}

function always(action: Action): DecisionPolicy {
  return () => action;
}

const NO_DRAIN: SimConfig = {
  ...DEFAULT_CONFIG,
  creature: { ...CREATURE, baseEnergyDrain: 0, baseHydrationDrain: 0 },
};

/** One creature on grass (lots of food) next to shallow water. */
/** A one-grass, one-water world; no climate (a single flood or drought would end it). */
const NO_CLIMATE: SimConfig = {
  ...DEFAULT_CONFIG,
  climate: { ...DEFAULT_CONFIG.climate, enabled: false },
};

function oasisWorld(policy: DecisionPolicy, config: SimConfig = NO_CLIMATE) {
  const map = makeMiniMap([[Biome.Grass, Biome.ShallowWater]], 100_000);
  const world = createWorld({ preset: 'small', seed: 1, map, populate: false, policy, config });
  const creature = world.spawnCreature(0, 0, 0)!;
  return { world, creature };
}

describe('creature fitness (plan §2.5)', () => {
  it('weights each term from config', () => {
    const s = stats({ ticksAlive: 100, foodEaten: 3, waterDrunk: 4, kills: 2, alliesHelped: 1 });
    const w = EVO.fitness;
    expect(creatureFitness(s, EVO)).toBe(
      100 * w.ticksAlive + 3 * w.foodEaten + 4 * w.waterDrunk + 2 * w.kills + 1 * w.alliesHelped,
    );
  });

  it('caps alliesHelped per generation, so SHARE farming stops paying', () => {
    const capped = creatureFitness(stats({ alliesHelped: EVO.maxAlliesHelped }), EVO);
    expect(creatureFitness(stats({ alliesHelped: 1000 }), EVO)).toBe(capped);
    expect(capped).toBe(EVO.maxAlliesHelped * EVO.fitness.alliesHelped);
  });
});

describe('exploits do not pay', () => {
  it('EAT spam at full energy earns nothing', () => {
    const { world, creature } = oasisWorld(always(Action.EAT), NO_DRAIN);
    for (let i = 0; i < 200; i++) world.tick();
    expect(creature.lastAction).toBe(Action.EAT);
    expect(creature.stats.foodEaten).toBe(0);
    expect(creatureFitness(creature.stats, EVO)).toBe(200 * EVO.fitness.ticksAlive);
  });

  it('DRINK spam at full hydration earns nothing', () => {
    const { world, creature } = oasisWorld(always(Action.DRINK), NO_DRAIN);
    for (let i = 0; i < 200; i++) world.tick();
    expect(creature.lastAction).toBe(Action.DRINK);
    expect(creature.stats.waterDrunk).toBe(0);
    expect(creatureFitness(creature.stats, EVO)).toBe(200 * EVO.fitness.ticksAlive);
  });

  it('EAT/DRINK spam is credited only for what metabolism burned, like eating when needed', () => {
    const ticks = 300;
    const eater = oasisWorld(always(Action.EAT));
    const drinker = oasisWorld(always(Action.DRINK));
    for (let i = 0; i < ticks; i++) {
      eater.world.tick();
      drinker.world.tick();
    }
    const burnedEnergy = ticks * CREATURE.baseEnergyDrain;
    const burnedWater = ticks * CREATURE.baseHydrationDrain;
    // Each spam action only refills last tick's drain: credit = refilled amount ÷ bite.
    expect(eater.creature.stats.foodEaten * CREATURE.eatBiteSize).toBeLessThanOrEqual(
      burnedEnergy + 1e-9,
    );
    expect(drinker.creature.stats.waterDrunk * CREATURE.drinkBiteSize).toBeLessThanOrEqual(
      burnedWater + 1e-9,
    );
    // ...whereas counting actions would have paid one bite per tick.
    expect(eater.creature.stats.foodEaten).toBeLessThan(ticks / 10);
    expect(drinker.creature.stats.waterDrunk).toBeLessThan(ticks / 10);
  });

  it('an only-STAY creature dies well before the generation ends (balance rule, plan §2.3)', () => {
    const world = createWorld({ preset: 'small', seed: 7, policy: always(Action.STAY) });
    while (world.livingCount > 0) world.tick();
    const shortestGeneration = Math.min(
      ...Object.values(MAP_PRESETS).map((p) => p.generationLength),
    );
    // Every creature has the same metabolism, so all die on the same tick.
    expect(world.tickCount).toBeLessThanOrEqual(600);
    expect(world.tickCount).toBeLessThan(shortestGeneration / 2);
    for (const c of world.creatures) {
      expect(c.stats.foodEaten).toBe(0);
      expect(c.stats.waterDrunk).toBe(0);
      expect(creatureFitness(c.stats, EVO)).toBe(c.stats.ticksAlive * EVO.fitness.ticksAlive);
    }
  });

  it('standing still scores far below foraging over a generation', () => {
    const generation = MAP_PRESETS.small.generationLength;
    const forage: DecisionPolicy = (_w, c) => (c.energy < c.hydration ? Action.EAT : Action.DRINK);
    const forager = oasisWorld(forage);
    const stayer = oasisWorld(always(Action.STAY));
    for (let i = 0; i < generation; i++) {
      forager.world.tick();
      stayer.world.tick();
    }
    expect(forager.creature.alive).toBe(true);
    expect(stayer.creature.alive).toBe(false);
    const foragerFitness = creatureFitness(forager.creature.stats, EVO);
    const stayerFitness = creatureFitness(stayer.creature.stats, EVO);
    expect(foragerFitness).toBeGreaterThan(2 * stayerFitness);
  });

  it('ATTACK and SHARE spam with nobody to hit or help earn nothing (more: combat.test.ts)', () => {
    // Small seed 7: the two tribes' zones are far apart (no enemy adjacent), and creatures doing
    // the same thing all have the same energy, so nobody is in need while a neighbour can spare.
    const run = (action: Action) => {
      const world = createWorld({ preset: 'small', seed: 7, policy: always(action) });
      while (world.livingCount > 0) world.tick();
      return world.creatures.map((c) => creatureFitness(c.stats, EVO));
    };
    const stay = run(Action.STAY);
    expect(run(Action.ATTACK)).toEqual(stay);
    expect(run(Action.SHARE)).toEqual(stay);
  });
});

describe('tribe score (plan §2.5, §2.6)', () => {
  it('counts only living members as survivors and effective intake as food gathered', () => {
    const world = createWorld({ preset: 'small', seed: 3, policy: always(Action.EAT) });
    for (let i = 0; i < 50; i++) world.tick();
    const members = world.creatures.filter((c) => c.tribeId === 0);
    members[0]!.alive = false;
    const outcome = tribeOutcome(members);
    expect(outcome.survivors).toBe(members.length - 1);
    // Full-energy creatures spamming EAT only refilled 50 ticks of drain each.
    const refilled = (members.length * 50 * CREATURE.baseEnergyDrain) / CREATURE.eatBiteSize;
    expect(outcome.foodGathered).toBeLessThanOrEqual(refilled + 1e-9);
    expect(outcome.territoryPct).toBe(0);
    const w = EVO.tribeScore;
    expect(tribeScore(outcome, EVO)).toBe(
      w.survivors * outcome.survivors + w.foodGathered * outcome.foodGathered,
    );
  });

  it('gives an all-dead tribe no survivor score', () => {
    const world = createWorld({ preset: 'small', seed: 3, policy: always(Action.STAY) });
    while (world.livingCount > 0) world.tick();
    const outcome = tribeOutcome(world.creatures.filter((c) => c.tribeId === 1));
    expect(outcome).toEqual({ survivors: 0, foodGathered: 0, territoryPct: 0 });
    expect(tribeScore(outcome, EVO)).toBe(0);
  });
});
