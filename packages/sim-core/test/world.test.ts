import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Action,
  Biome,
  createWorld,
  DEFAULT_CONFIG,
  hashMap,
  isWalkable,
  NO_CREATURE,
  type DecisionPolicy,
  type WorldMap,
} from '../src/index.js';

function makeFlatGrassMap(width: number, height: number, maxFoodVal = 60): WorldMap {
  const size = width * height;
  return {
    width,
    height,
    preset: 'small',
    seed: 'flat',
    attempt: 0,
    walkableCount: size,
    biomes: new Uint8Array(size).fill(Biome.Grass),
    maxFood: new Float32Array(size).fill(maxFoodVal),
    food: new Float32Array(size).fill(maxFoodVal),
    waterDx: new Int16Array(size),
    waterDy: new Int16Array(size),
    spawnZones: [],
    hotspots: [],
    hash: '0000000000000001',
  };
}

describe('World simulation & two-phase tick', () => {
  it('spawns exact starting creatures per tribe inside spawn zones with 1 creature per tile', () => {
    const world = createWorld({ preset: 'small', seed: 42 });
    const preset = DEFAULT_CONFIG.presets.small;
    expect(world.creatures).toHaveLength(preset.tribeCount * preset.startingCreaturesPerTribe);
    expect(world.livingCount).toBe(world.creatures.length);

    const perTribe = new Map<number, number>();
    for (const c of world.creatures) {
      perTribe.set(c.tribeId, (perTribe.get(c.tribeId) ?? 0) + 1);
      const zone = world.map.spawnZones[c.tribeId]!;
      const dx = c.x - zone.x;
      const dy = c.y - zone.y;
      expect(dx * dx + dy * dy).toBeLessThanOrEqual(zone.radius * zone.radius);
    }
    for (const zone of world.map.spawnZones) {
      expect(perTribe.get(zone.tribeId)).toBe(preset.startingCreaturesPerTribe);
    }

    let occupiedCount = 0;
    for (let i = 0; i < world.occupancy.length; i++) {
      if (world.occupancy[i] !== NO_CREATURE) {
        occupiedCount++;
        expect(isWalkable(world.map.biomes[i]!)).toBe(true);
      }
    }
    expect(occupiedCount).toBe(world.livingCount);
  });

  it('throws if a spawn zone cannot fit startingCreaturesPerTribe reachable tiles', () => {
    const tinyMap = makeFlatGrassMap(3, 3);
    const badMap: WorldMap = {
      ...tinyMap,
      spawnZones: [
        {
          tribeId: 0,
          x: 1,
          y: 1,
          radius: 1, // max 5 tiles vs 25 startingCreaturesPerTribe
          walkableCount: 5,
          foodInFairnessRadius: 300,
          waterInFairnessRadius: 6,
        },
      ],
    };
    expect(() => createWorld({ preset: 'small', seed: 1, map: badMap })).toThrow(
      /Spawn zone for tribe 0 only fit/,
    );
  });

  it('does not mutate caller-owned WorldMap.food when creating and ticking a World', () => {
    const callerMap = makeFlatGrassMap(4, 4, 60);
    const initialFood = Array.from(callerMap.food);
    const world = createWorld({
      preset: 'small',
      seed: 1,
      map: callerMap,
      populate: false,
      policy: (w) => (w.tickCount === 0 ? Action.EAT : Action.STAY),
    });
    const c = world.spawnCreature(0, 1, 1)!;
    c.energy = 80;
    world.tick();

    expect(Array.from(callerMap.food)).toEqual(initialFood);
    expect(world.map.food[1 * 4 + 1]).toBeLessThan(60);
    expect(hashMap(callerMap)).toBe(hashMap(callerMap));
  });

  it('regrows only depleted tiles via active list, handles Float32 boundaries and swap-remove', () => {
    // 1. Basic active-list regrowth + removal.
    const map = makeFlatGrassMap(4, 4, 10);
    const eatWorld = createWorld({
      preset: 'small',
      seed: 1,
      map,
      populate: false,
      policy: (w) => (w.tickCount === 0 ? Action.EAT : Action.STAY),
    });
    const eater = eatWorld.spawnCreature(0, 1, 1)!;
    eater.energy = 99.5;
    eatWorld.tick();

    expect(eatWorld.getDepletedTileCount()).toBe(1);
    expect(eatWorld.getTileFood(1, 1)).toBeCloseTo(9.5, 5);

    for (let i = 0; i < 4; i++) {
      eatWorld.tick();
    }
    expect(eatWorld.getTileFood(1, 1)).toBe(10);
    expect(eatWorld.getDepletedTileCount()).toBe(0);

    // 2. Float32 boundary (max=60, food=fround(60 - 0.15)) clears active list on exact tick.
    const f32Map = makeFlatGrassMap(3, 1, 60);
    f32Map.food[0] = Math.fround(60 - 0.15); // depleted at index 0 (finishes in 1 tick)
    f32Map.food[1] = 59.0; // depleted at index 1 (finishes later -> tests swap-remove!)
    const f32World = createWorld({ preset: 'small', seed: 1, map: f32Map, populate: false });
    expect(f32World.getDepletedTileCount()).toBe(2);

    f32World.regrowResources();
    expect(f32World.map.food[0]).toBe(60);
    expect(f32World.getDepletedTileCount()).toBe(1);

    // 3. regrowthRate = 0 does not regrow.
    const zeroRegrowConfig = {
      ...DEFAULT_CONFIG,
      food: { regrowthRate: 0 },
    };
    const noRegrow = createWorld({
      preset: 'small',
      seed: 1,
      map: f32Map,
      config: zeroRegrowConfig,
      populate: false,
    });
    noRegrow.regrowResources();
    expect(noRegrow.getDepletedTileCount()).toBe(2);
  });

  it('validates bounds, NaN, and Float32 conservation in consumeFood, spawnCreature, and moveCreature', () => {
    const map = makeFlatGrassMap(3, 3, 100);
    map.biomes[0] = Biome.Mountain;
    map.maxFood[0] = 0;
    map.food[0] = 0;
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });

    // Invalid spawnCreature & out-of-bounds helpers.
    expect(world.spawnCreature(0, -1, 0)).toBeNull();
    expect(world.spawnCreature(0, 3, 0)).toBeNull();
    expect(world.spawnCreature(0, 0, 0)).toBeNull(); // Mountain
    expect(world.isTileEmpty(-1, 0)).toBe(false);
    expect(world.isTileEmpty(Number.NaN, 0)).toBe(false);
    expect(world.getTileFood(-1, 0)).toBe(0);
    expect(world.getTileFood(Number.NaN, 0)).toBe(0);

    const c1 = world.spawnCreature(0, 1, 1)!;
    const c2 = world.spawnCreature(1, 2, 1)!;
    expect(world.spawnCreature(0, 1, 1)).toBeNull(); // occupied

    // Invalid consumeFood inputs.
    expect(world.consumeFood(-1, 0, 10)).toBe(0);
    expect(world.consumeFood(1, 1, 0)).toBe(0);
    expect(world.consumeFood(1, 1, -5)).toBe(0);
    expect(world.consumeFood(1, 1, Number.NaN)).toBe(0);
    expect(world.consumeFood(1, 1, Number.POSITIVE_INFINITY)).toBe(0);

    // Sub-ULP Float32 amount at 100 returns 0 and does NOT falsely mark full tile depleted.
    expect(world.consumeFood(1, 1, 1e-6)).toBe(0);
    expect(world.getTileFood(1, 1)).toBe(100);
    expect(world.getDepletedTileCount()).toBe(0);

    // Exact Float32 conservation at 60 with 0.35.
    const idx2 = 1 * 3 + 2;
    world.map.maxFood[idx2] = 60;
    world.map.food[idx2] = 60;
    const actual = world.consumeFood(2, 1, 0.35);
    expect(actual).toBe(60 - world.map.food[idx2]);

    // moveCreature rejects invalid targets and dead creatures.
    expect(() => {
      world.moveCreature(c1, -1, 1, Action.MOVE_W);
    }).toThrow(RangeError);
    expect(() => {
      world.moveCreature(c1, 0, 0, Action.MOVE_N);
    }).toThrow(RangeError); // Mountain
    expect(() => {
      world.moveCreature(c1, 2, 1, Action.MOVE_E);
    }).toThrow(RangeError); // occupied by c2
    c2.alive = false;
    expect(() => {
      world.moveCreature(c2, 0, 1, Action.MOVE_W);
    }).toThrow(RangeError);
  });

  it('evaluates all policies in Phase A before applying moves in seeded shuffled Phase B and updates prevX/prevY', () => {
    const seenPositionsInPhaseA: Array<{ id: number; x0: number; x1: number }> = [];
    const duelPolicy: DecisionPolicy = (w, c) => {
      seenPositionsInPhaseA.push({
        id: c.id,
        x0: w.creatures[0]!.x,
        x1: w.creatures[1]!.x,
      });
      return c.x === 0 ? Action.MOVE_E : c.x === 2 ? Action.MOVE_W : Action.STAY;
    };

    let c0Wins = 0;
    let c1Wins = 0;

    for (let seed = 1; seed <= 40; seed++) {
      const world = createWorld({
        preset: 'small',
        seed,
        map: makeFlatGrassMap(3, 1),
        populate: false,
        policy: duelPolicy,
      });
      const c0 = world.spawnCreature(0, 0, 0)!;
      const c1 = world.spawnCreature(1, 2, 0)!;
      seenPositionsInPhaseA.length = 0;

      world.tick();

      expect(seenPositionsInPhaseA).toEqual([
        { id: 0, x0: 0, x1: 2 },
        { id: 1, x0: 0, x1: 2 },
      ]);
      expect([c0.prevX, c0.prevY]).toEqual([0, 0]);
      expect([c1.prevX, c1.prevY]).toEqual([2, 0]);

      if (c0.x === 1) c0Wins++;
      if (c1.x === 1) c1Wins++;
      expect(c0Wins + c1Wins).toBe(seed);
    }

    expect(c0Wins).toBeGreaterThan(5);
    expect(c1Wins).toBeGreaterThan(5);
  });

  it('frees occupancy when a creature dies of maxAge or starvation so a neighbor can enter', () => {
    // 1. maxAge death clears occupancy.
    const agedWorld = createWorld({
      preset: 'small',
      seed: 1,
      map: makeFlatGrassMap(2, 1),
      populate: false,
      maxAge: 1,
      policy: () => Action.STAY,
    });
    const aged = agedWorld.spawnCreature(0, 0, 0)!;
    agedWorld.tick();
    expect(aged.alive).toBe(false);
    expect(agedWorld.occupancy[0]).toBe(NO_CREATURE);

    // 2. Starvation death frees occupancy so neighbor moves in next tick.
    const starvWorld = createWorld({
      preset: 'small',
      seed: 1,
      map: makeFlatGrassMap(2, 1),
      populate: false,
      maxAge: 100,
      policy: (_w, c) => (c.id === 1 ? Action.MOVE_W : Action.STAY),
    });
    const dying = starvWorld.spawnCreature(0, 0, 0)!;
    dying.energy = 0;
    dying.health = 0.2;
    const mover = starvWorld.spawnCreature(1, 1, 0)!;

    starvWorld.tick();
    expect(dying.alive).toBe(false);
    expect(starvWorld.occupancy[0]).toBe(NO_CREATURE);
    expect(mover.x).toBe(1);

    starvWorld.tick();
    expect([mover.prevX, mover.x]).toEqual([1, 0]);
    expect(starvWorld.occupancy[0]).toBe(mover.id);
    expect(starvWorld.occupancy[1]).toBe(NO_CREATURE);
  });

  it('produces identical world hashes for the same seed and diverges for different seeds', () => {
    const a = createWorld({ preset: 'small', seed: 'replay-check' });
    const b = createWorld({ preset: 'small', seed: 'replay-check' });
    const c = createWorld({ preset: 'small', seed: 'replay-check-2' });

    for (let i = 0; i < 200; i++) {
      a.tick();
      b.tick();
      c.tick();
    }

    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).not.toBe(c.hash());
  });

  it('maintains world, occupancy, and depleted-list invariants across random ticks and through deaths', () => {
    const checkInvariants = (world: ReturnType<typeof createWorld>): void => {
      const { width, biomes, food, maxFood } = world.map;
      let aliveCount = 0;
      const seenTiles = new Set<number>();

      for (const c of world.creatures) {
        expect(c.health).toBeGreaterThanOrEqual(0);
        expect(c.health).toBeLessThanOrEqual(world.config.creature.maxHealth);
        expect(c.energy).toBeGreaterThanOrEqual(0);
        expect(c.energy).toBeLessThanOrEqual(world.config.creature.maxEnergy);
        expect(c.hydration).toBeGreaterThanOrEqual(0);
        expect(c.hydration).toBeLessThanOrEqual(world.config.creature.maxHydration);

        if (c.alive) {
          aliveCount++;
          const idx = c.y * width + c.x;
          expect(isWalkable(biomes[idx]!)).toBe(true);
          expect(world.occupancy[idx]).toBe(c.id);
          expect(seenTiles.has(idx)).toBe(false);
          seenTiles.add(idx);
        }
      }

      expect(world.livingCount).toBe(aliveCount);

      let occupiedInArray = 0;
      let actualDepleted = 0;
      for (let i = 0; i < world.occupancy.length; i++) {
        if (world.occupancy[i] !== NO_CREATURE) occupiedInArray++;
        expect(food[i]).toBeGreaterThanOrEqual(0);
        expect(food[i]).toBeLessThanOrEqual(maxFood[i]!);
        if (food[i]! < maxFood[i]!) actualDepleted++;
      }
      expect(occupiedInArray).toBe(aliveCount);
      expect(world.getDepletedTileCount()).toBe(actualDepleted);
    };

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 40 }),
        (seed, ticks) => {
          const world = createWorld({ preset: 'small', seed });
          for (let t = 0; t < ticks; t++) {
            world.tick();
          }
          checkInvariants(world);
        },
      ),
      { numRuns: 20 },
    );

    // Longer run (> 500 ticks) exercising random starvation/dehydration deaths and occupancy cleanup.
    const longWorld = createWorld({ preset: 'small', seed: 777 });
    for (let t = 0; t < 550; t++) {
      longWorld.tick();
    }
    expect(longWorld.livingCount).toBeLessThan(longWorld.creatures.length);
    checkInvariants(longWorld);
  }, 30_000);
  it('gives policies the dedicated policy stream, so their draws never change the Phase B shuffle', () => {
    // Same moves in both worlds (so Phase B order matters for blocked tiles); only the draws differ.
    const move = (id: number): Action => (id % 2 === 0 ? Action.MOVE_E : Action.MOVE_N);
    const quiet: DecisionPolicy = (world, creature, rng) => {
      expect(rng).toBe(world.rng.policy);
      return move(creature.id);
    };
    const noisy: DecisionPolicy = (_world, creature, rng) => {
      rng.nextUint32();
      rng.nextUint32();
      return move(creature.id);
    };
    const a = createWorld({ preset: 'small', seed: 11, policy: quiet });
    const b = createWorld({ preset: 'small', seed: 11, policy: noisy });
    for (let t = 0; t < 25; t++) {
      a.tick();
      b.tick();
    }
    expect(b.rng.tick.getState()).toEqual(a.rng.tick.getState());
    expect(b.rng.policy.getState()).not.toEqual(a.rng.policy.getState());
    expect(b.creatures.map((c) => [c.x, c.y, c.energy])).toEqual(
      a.creatures.map((c) => [c.x, c.y, c.energy]),
    );
  });
});
