// Sprint 4.1: ATTACK, kills and SHARE (plan §2.3), with exploit tests for the kills and
// alliesHelped fitness terms (CLAUDE.md, plan §4 "SHARE ping-pong earns no extra fitness").
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Action,
  applyAction,
  Biome,
  createWorld,
  creatureFitness,
  DEFAULT_CONFIG,
  type Creature,
  type DecisionPolicy,
  type SimConfig,
  type World,
} from '../src/index.js';
import { makeMiniMap } from './mini-map.js';

const CREATURE = DEFAULT_CONFIG.creature;
const EVO = DEFAULT_CONFIG.evolution;

/**
 * Around a creature at (1, 1): the first and the last neighbour tile of the 8-neighbourhood
 * search, in both orders, for tie-break tests (lower id spawned on the first tile of each pair).
 */
const TIED_TILES: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [
    [0, 0],
    [2, 2],
  ],
  [
    [2, 2],
    [0, 0],
  ],
];

/** A width × height grass world (food `food` per tile), nobody spawned yet. */
function grassWorld(
  width: number,
  height: number,
  options: { food?: number; policy?: DecisionPolicy; config?: SimConfig; biome?: Biome } = {},
): World {
  const row = new Array<Biome>(width).fill(options.biome ?? Biome.Grass);
  const map = makeMiniMap(
    Array.from({ length: height }, () => [...row]),
    options.food ?? 50,
  );
  return createWorld({
    preset: 'small',
    seed: 'combat',
    map,
    populate: false,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.config === undefined ? {} : { config: options.config }),
  });
}

function spawn(world: World, tribeId: number, x: number, y: number, set: Partial<Creature> = {}) {
  const c = world.spawnCreature(tribeId, x, y)!;
  expect(c).not.toBeNull();
  Object.assign(c, set);
  return c;
}

describe('ATTACK (plan §2.3)', () => {
  it('hits an adjacent enemy, diagonals included, for attackDamage at attackEnergyCost', () => {
    const world = grassWorld(3, 3);
    const attacker = spawn(world, 0, 1, 1);
    const enemy = spawn(world, 1, 2, 2);
    expect(applyAction(world, attacker, Action.ATTACK)).toBe(Action.ATTACK);
    expect(enemy.health).toBe(CREATURE.maxHealth - CREATURE.attackDamage);
    expect(attacker.energy).toBe(CREATURE.maxEnergy - CREATURE.attackEnergyCost);
    expect(attacker.stats.kills).toBe(0);
  });

  it('never hits allies or creatures out of reach: then it is STAY and costs nothing', () => {
    const world = grassWorld(4, 3);
    const attacker = spawn(world, 0, 1, 1);
    const ally = spawn(world, 0, 0, 0);
    const farEnemy = spawn(world, 1, 3, 1);
    expect(applyAction(world, attacker, Action.ATTACK)).toBe(Action.STAY);
    expect(ally.health).toBe(CREATURE.maxHealth);
    expect(farEnemy.health).toBe(CREATURE.maxHealth);
    expect(attacker.energy).toBe(CREATURE.maxEnergy);
  });

  it('picks the enemy with the lowest health, ties to the lowest id wherever it stands', () => {
    // The tied pair sits on the first and the last neighbour tile the target search visits, both
    // ways round, so neither "first found" nor "last found" can pass for "lowest id".
    for (const [lowAt, highAt] of TIED_TILES) {
      const world = grassWorld(3, 3);
      const attacker = spawn(world, 0, 1, 1);
      const healthy = spawn(world, 1, 1, 0, { health: 50 });
      const weakLow = spawn(world, 2, ...lowAt, { health: 30 });
      const weakHigh = spawn(world, 1, ...highAt, { health: 30 });
      expect(weakLow.id).toBeLessThan(weakHigh.id);
      applyAction(world, attacker, Action.ATTACK);
      expect(weakLow.health).toBe(30 - CREATURE.attackDamage);
      expect(weakHigh.health).toBe(30);
      expect(healthy.health).toBe(50);
    }
  });

  it('kills at 0 health: the victim leaves its tile, the killer gets the kill and loot', () => {
    const world = grassWorld(2, 1);
    const attacker = spawn(world, 0, 0, 0, { energy: 60 });
    const victim = spawn(world, 1, 1, 0, { health: CREATURE.attackDamage, energy: 40 });
    expect(world.livingCount).toBe(2);
    applyAction(world, attacker, Action.ATTACK);
    expect(victim.alive).toBe(false);
    expect(victim.health).toBe(0);
    expect(world.isTileEmpty(1, 0)).toBe(true);
    expect(world.creatureAt(1, 0)).toBeUndefined();
    expect(world.livingCount).toBe(1);
    expect(attacker.stats.kills).toBe(1);
    const loot = CREATURE.killEnergyFraction * 40;
    expect(attacker.energy).toBe(60 - CREATURE.attackEnergyCost + loot);
    // Dead creatures are no target: the next ATTACK finds nobody.
    expect(applyAction(world, attacker, Action.ATTACK)).toBe(Action.STAY);
    expect(attacker.stats.kills).toBe(1);
  });

  it('caps the loot at max energy', () => {
    const world = grassWorld(2, 1);
    const attacker = spawn(world, 0, 0, 0, { energy: 99 });
    spawn(world, 1, 1, 0, { health: 1, energy: 100 });
    applyAction(world, attacker, Action.ATTACK);
    expect(attacker.energy).toBe(CREATURE.maxEnergy);
  });

  it('kills inside Phase B: the victim does not act, gets no metabolism, and its tile frees up', () => {
    // Two enemies at 1 health hit each other; whoever the seeded shuffle lets act first wins.
    const world = grassWorld(3, 1, { policy: () => Action.ATTACK });
    const a = spawn(world, 0, 0, 0, { health: 1 });
    const b = spawn(world, 1, 1, 0, { health: 1 });
    world.tick();
    const [winner, loser] = a.alive ? [a, b] : [b, a];
    expect(winner.alive).toBe(true);
    expect(loser.alive).toBe(false);
    expect(winner.stats.kills).toBe(1);
    expect(loser.stats.kills).toBe(0);
    expect(winner.lastAction).toBe(Action.ATTACK);
    expect(loser.stats.ticksAlive).toBe(0);
    expect(winner.stats.ticksAlive).toBe(1);
    expect(world.livingCount).toBe(1);
  });

  it("frees the victim's tile at once: a creature acting later in the same tick can step there", () => {
    // Phase B applies the actions one by one in the shuffled order; here the order is set by hand.
    const world = grassWorld(3, 1);
    const attacker = spawn(world, 0, 0, 0);
    const victim = spawn(world, 1, 1, 0, { health: CREATURE.attackDamage });
    const mover = spawn(world, 0, 2, 0);
    expect(applyAction(world, mover, Action.MOVE_W)).toBe(Action.STAY); // still occupied
    applyAction(world, attacker, Action.ATTACK);
    expect(victim.alive).toBe(false);
    expect(applyAction(world, mover, Action.MOVE_W)).toBe(Action.MOVE_W);
    expect(world.creatureAt(1, 0)).toBe(mover);
    expect([victim.x, victim.y]).toEqual([1, 0]); // the body stays where it fell, off the grid
  });

  it('credits the kill to the killing blow only, whoever did the earlier damage', () => {
    const world = grassWorld(3, 1);
    const first = spawn(world, 0, 0, 0);
    const victim = spawn(world, 1, 1, 0, { health: 2 * CREATURE.attackDamage });
    const last = spawn(world, 2, 2, 0);
    applyAction(world, first, Action.ATTACK);
    applyAction(world, last, Action.ATTACK);
    expect(victim.alive).toBe(false);
    expect(first.stats.kills).toBe(0);
    expect(last.stats.kills).toBe(1);
  });
});

describe('kills exploit tests (fitness term kills)', () => {
  it('a victim that dies of thirst after being hit credits no kill', () => {
    let attack = true;
    const world = grassWorld(2, 1, {
      policy: (_w, c) => (attack && c.tribeId === 0 ? Action.ATTACK : Action.STAY),
    });
    const attacker = spawn(world, 0, 0, 0);
    const victim = spawn(world, 1, 1, 0, { hydration: 0 });
    world.tick();
    attack = false;
    expect(victim.health).toBeLessThan(CREATURE.maxHealth - CREATURE.attackDamage);
    while (victim.alive) world.tick();
    expect(attacker.stats.kills).toBe(0);
    expect(creatureFitness(attacker.stats, EVO)).toBe(attacker.stats.ticksAlive);
  });

  it('every death in a fight credits exactly one kill, for random brawls', () => {
    const tribe = fc.integer({ min: 0, max: 2 });
    let totalKills = 0;
    fc.assert(
      fc.property(
        fc.array(tribe, { minLength: 49, maxLength: 49 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (tribes, seed) => {
          // A 7×7 block of creatures from up to 3 tribes, all attacking, for 60 ticks: far too
          // short to die of hunger or thirst, so every death is an ATTACK's killing blow.
          const map = makeMiniMap(
            Array.from({ length: 7 }, () => new Array<Biome>(7).fill(Biome.Grass)),
          );
          const world = createWorld({
            preset: 'small',
            seed,
            map,
            populate: false,
            policy: () => Action.ATTACK,
          });
          tribes.forEach((t, i) => world.spawnCreature(t, i % 7, Math.floor(i / 7)));
          for (let t = 0; t < 60; t++) world.tick();
          const kills = world.creatures.reduce((acc, c) => acc + c.stats.kills, 0);
          const deaths = world.creatures.filter((c) => !c.alive).length;
          expect(kills).toBe(deaths);
          totalKills += kills;
          expect(world.livingCount).toBe(world.creatures.length - deaths);
        },
      ),
      { numRuns: 25 },
    );
    expect(totalKills).toBeGreaterThan(25);
  });
});

describe('SHARE (plan §2.3)', () => {
  it('gives shareAmount to the adjacent ally in need, who gains it at shareEfficiency', () => {
    const world = grassWorld(3, 3);
    const giver = spawn(world, 0, 1, 1, { energy: 80 });
    const needy = spawn(world, 0, 0, 2, { energy: 30 });
    expect(applyAction(world, giver, Action.SHARE)).toBe(Action.SHARE);
    expect(giver.energy).toBe(80 - CREATURE.shareAmount);
    expect(needy.energy).toBe(30 + CREATURE.shareAmount * CREATURE.shareEfficiency);
    expect(giver.stats.alliesHelped).toBe(1);
    expect(needy.stats.alliesHelped).toBe(0);
  });

  it('helps the ally with the lowest energy, ties to the lowest id wherever it stands, never an enemy', () => {
    for (const [lowAt, highAt] of TIED_TILES) {
      const world = grassWorld(3, 3);
      const giver = spawn(world, 0, 1, 1);
      const starvingEnemy = spawn(world, 1, 1, 0, { energy: 1 });
      const fed = spawn(world, 0, 0, 2, { energy: 45 });
      const hungryLow = spawn(world, 0, ...lowAt, { energy: 20 });
      const hungryHigh = spawn(world, 0, ...highAt, { energy: 20 });
      expect(hungryLow.id).toBeLessThan(hungryHigh.id);
      applyAction(world, giver, Action.SHARE);
      expect(hungryLow.energy).toBe(20 + CREATURE.shareAmount * CREATURE.shareEfficiency);
      expect(hungryHigh.energy).toBe(20);
      expect(fed.energy).toBe(45);
      expect(starvingEnemy.energy).toBe(1);
    }
  });

  it('needs an ally below shareNeedRatio and a giver that keeps shareKeepRatio', () => {
    const keep = CREATURE.shareKeepRatio * CREATURE.maxEnergy;
    const need = CREATURE.shareNeedRatio * CREATURE.maxEnergy;
    const cases: [number, number, Action][] = [
      [100, need, Action.STAY], // ally exactly at the threshold is not in need
      [100, need - 0.001, Action.SHARE],
      [keep + CREATURE.shareAmount, 10, Action.SHARE], // giver ends exactly at keep
      [keep + CREATURE.shareAmount - 0.001, 10, Action.STAY],
      [30, 10, Action.STAY], // a hungry giver can't share
    ];
    for (const [giverEnergy, allyEnergy, expected] of cases) {
      const world = grassWorld(2, 1);
      const giver = spawn(world, 0, 0, 0, { energy: giverEnergy });
      const ally = spawn(world, 0, 1, 0, { energy: allyEnergy });
      expect(applyAction(world, giver, Action.SHARE)).toBe(expected);
      const shared = expected === Action.SHARE;
      expect(giver.energy).toBe(shared ? giverEnergy - CREATURE.shareAmount : giverEnergy);
      expect(ally.energy).toBe(
        shared ? allyEnergy + CREATURE.shareAmount * CREATURE.shareEfficiency : allyEnergy,
      );
      expect(giver.stats.alliesHelped).toBe(shared ? 1 : 0);
    }
  });

  it('caps the recipient at max energy', () => {
    const config: SimConfig = {
      ...DEFAULT_CONFIG,
      creature: { ...CREATURE, shareEfficiency: 10 },
    };
    const world = grassWorld(2, 1, { config });
    const giver = spawn(world, 0, 0, 0);
    const ally = spawn(world, 0, 1, 0, { energy: 40 });
    applyAction(world, giver, Action.SHARE);
    expect(ally.energy).toBe(CREATURE.maxEnergy);
  });
});

describe('SHARE ping-pong exploit tests (fitness term alliesHelped, plan §4 Sprint 4.1)', () => {
  /**
   * Two adjacent allies on bare sand (no food, no water) that both always SHARE, or both always
   * STAY, from the given energies, until both are dead. Returns per creature: fitness and how many
   * shares it gave and received. In a pair every valid SHARE goes to the other one, so the shares
   * received are exactly the partner's `alliesHelped`, even when both give in the same tick.
   */
  function pair(energies: readonly [number, number], action: Action) {
    const world = grassWorld(2, 1, { food: 0, policy: () => action, biome: Biome.Sand });
    const a = spawn(world, 0, 0, 0, { energy: energies[0] });
    const b = spawn(world, 0, 1, 0, { energy: energies[1] });
    while (world.livingCount > 0) world.tick();
    return [
      [a, b],
      [b, a],
    ].map(([c, partner]) => ({
      fitness: creatureFitness(c!.stats, EVO),
      ticksAlive: c!.stats.ticksAlive,
      gave: c!.stats.alliesHelped,
      received: partner!.stats.alliesHelped,
    }));
  }

  it('two hungry allies can not share at all: same fitness as standing still', () => {
    const shared = pair([45, 40], Action.SHARE);
    const stayed = pair([45, 40], Action.STAY);
    expect(shared).toEqual(stayed);
    expect(shared.every((c) => c.gave === 0)).toBe(true);
  });

  it('energy never flows back: no ally both gives and receives, for any starting energies', () => {
    const energy = fc.double({ min: 0, max: 100, noNaN: true });
    fc.assert(
      fc.property(energy, energy, (e0, e1) => {
        const result = pair([e0, e1], Action.SHARE);
        for (const c of result) {
          expect(c.gave > 0 && c.received > 0).toBe(false);
        }
        // Only a creature with energy to spare (≥ keep + amount) ever gives, and at most as many
        // times as its surplus allows.
        const surplus = (e: number) =>
          Math.max(
            0,
            Math.floor(
              (e - CREATURE.shareKeepRatio * CREATURE.maxEnergy) / CREATURE.shareAmount + 1e-9,
            ),
          );
        expect(result[0]!.gave).toBeLessThanOrEqual(surplus(e0));
        expect(result[1]!.gave).toBeLessThanOrEqual(surplus(e1));
      }),
      { numRuns: 60 },
    );
  });

  it('a real one-way help is the only extra fitness', () => {
    const shared = pair([100, 10], Action.SHARE);
    const stayed = pair([100, 10], Action.STAY);
    const [giver] = shared;
    expect(giver!.gave).toBeGreaterThan(0);
    expect(shared[1]!.gave).toBe(0);
    const bonus = EVO.fitness.alliesHelped * Math.min(giver!.gave, EVO.maxAlliesHelped);
    // The giver gave energy away, so it can only live as long as before or shorter.
    expect(giver!.ticksAlive).toBeLessThanOrEqual(stayed[0]!.ticksAlive);
    expect(giver!.fitness).toBeLessThanOrEqual(stayed[0]!.fitness + bonus);
  });

  it('a giver that keeps eating helps more than maxAlliesHelped times; fitness counts the cap', () => {
    // A giver on rich grass shares whenever it can spare the energy and eats otherwise; eight
    // starving allies around it stand still. Every share is valid, far more than the cap.
    const canSpare = CREATURE.shareKeepRatio * CREATURE.maxEnergy + CREATURE.shareAmount;
    const world = grassWorld(3, 3, {
      food: 1000,
      policy: (_w, c) =>
        c.id !== 0 ? Action.STAY : c.energy >= canSpare ? Action.SHARE : Action.EAT,
    });
    const giver = spawn(world, 0, 1, 1);
    for (let i = 0; i < 9; i++) {
      if (i !== 4) spawn(world, 0, i % 3, Math.floor(i / 3), { energy: 0 });
    }
    for (let t = 0; t < 100; t++) world.tick();
    expect(giver.stats.alliesHelped).toBeGreaterThan(2 * EVO.maxAlliesHelped);
    const withoutHelp = creatureFitness({ ...giver.stats, alliesHelped: 0 }, EVO);
    expect(creatureFitness(giver.stats, EVO) - withoutHelp).toBeCloseTo(
      EVO.fitness.alliesHelped * EVO.maxAlliesHelped,
      9,
    );
  });
});
