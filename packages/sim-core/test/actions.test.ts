import { describe, expect, it } from 'vitest';
import {
  Action,
  applyAction,
  Biome,
  createWorld,
  DEFAULT_CONFIG,
  isWaterReachable,
  type WorldMap,
} from '../src/index.js';

function makeMiniMap(biomesGrid: Biome[][], foodVal = 50): WorldMap {
  const height = biomesGrid.length;
  const width = biomesGrid[0]!.length;
  const size = width * height;
  const biomes = new Uint8Array(size);
  const maxFood = new Float32Array(size);
  const food = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const b = biomesGrid[y]![x]!;
      biomes[idx] = b;
      const mf = b === Biome.Grass || b === Biome.Forest || b === Biome.Sand ? foodVal : 0;
      maxFood[idx] = mf;
      food[idx] = mf;
    }
  }

  return {
    width,
    height,
    preset: 'small',
    seed: 'mini',
    attempt: 0,
    walkableCount: size,
    biomes,
    maxFood,
    food,
    waterDx: new Int16Array(size),
    waterDy: new Int16Array(size),
    spawnZones: [],
    hotspots: [],
    hash: '0000000000000000',
  };
}

describe('Phase 2 actions', () => {
  it('moves in all 4 cardinal directions, updates occupancy and allows moving at 0 energy', () => {
    const map = makeMiniMap([
      [Biome.Grass, Biome.Grass, Biome.Grass],
      [Biome.Grass, Biome.Grass, Biome.Grass],
      [Biome.Grass, Biome.Grass, Biome.Grass],
    ]);
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 1, 1)!;

    expect(applyAction(world, c, Action.MOVE_N)).toBe(Action.MOVE_N);
    expect([c.x, c.y, c.lastMoveDir]).toEqual([1, 0, Action.MOVE_N]);
    expect(world.occupancy[0 * 3 + 1]).toBe(c.id);
    expect(world.occupancy[1 * 3 + 1]).toBe(-1);

    expect(applyAction(world, c, Action.MOVE_E)).toBe(Action.MOVE_E);
    expect([c.x, c.y]).toEqual([2, 0]);

    expect(applyAction(world, c, Action.MOVE_S)).toBe(Action.MOVE_S);
    expect([c.x, c.y]).toEqual([2, 1]);

    expect(applyAction(world, c, Action.MOVE_W)).toBe(Action.MOVE_W);
    expect([c.x, c.y]).toEqual([1, 1]);

    expect(c.energy).toBeCloseTo(
      DEFAULT_CONFIG.creature.maxEnergy - 4 * DEFAULT_CONFIG.creature.moveEnergyCost,
      10,
    );

    // Starving creature (energy === 0) can still move and energy stays clamped at 0.
    c.energy = 0;
    expect(applyAction(world, c, Action.MOVE_W)).toBe(Action.MOVE_W);
    expect([c.x, c.y, c.energy]).toEqual([0, 1, 0]);
  });

  it('rejects out-of-bounds, Mountain, DeepWater, occupied tiles, and dead creatures as STAY', () => {
    const map = makeMiniMap([
      [Biome.Mountain, Biome.Grass, Biome.DeepWater],
      [Biome.Grass, Biome.Grass, Biome.Grass],
    ]);
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 1, 0)!;
    const blocker = world.spawnCreature(1, 1, 1)!;
    expect(blocker.id).toBe(1);

    const startEnergy = c.energy;
    expect(applyAction(world, c, Action.STAY)).toBe(Action.STAY);
    expect(applyAction(world, c, Action.MOVE_N)).toBe(Action.STAY); // out of bounds
    expect(applyAction(world, c, Action.MOVE_W)).toBe(Action.STAY); // mountain
    expect(applyAction(world, c, Action.MOVE_E)).toBe(Action.STAY); // deep water
    expect(applyAction(world, c, Action.MOVE_S)).toBe(Action.STAY); // occupied
    expect([c.x, c.y]).toEqual([1, 0]);
    expect(c.energy).toBe(startEnergy);

    c.alive = false;
    c.moveCooldown = 1;
    expect(applyAction(world, c, Action.MOVE_N)).toBe(Action.STAY);
    expect(c.moveCooldown).toBe(1); // no mutation on dead creature
  });

  it('applies 2x move energy cost and slowTileMoveCooldown (0, 1, 2) on Forest and ShallowWater', () => {
    const map = makeMiniMap([
      [Biome.Grass, Biome.Forest, Biome.ShallowWater, Biome.Grass],
      [Biome.Grass, Biome.Grass, Biome.Grass, Biome.Grass],
    ]);
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 0, 0)!;
    const cfg = DEFAULT_CONFIG.creature;

    // Enter Forest -> 2x cost and moveCooldown = 1.
    expect(applyAction(world, c, Action.MOVE_E)).toBe(Action.MOVE_E);
    expect([c.x, c.y, c.moveCooldown]).toEqual([1, 0, 1]);
    expect(c.energy).toBeCloseTo(
      cfg.maxEnergy - cfg.moveEnergyCost * cfg.slowTileMoveMultiplier,
      10,
    );

    // Performing EAT during cooldown executes EAT AND decrements moveCooldown to 0.
    c.energy = 80;
    expect(applyAction(world, c, Action.EAT)).toBe(Action.EAT);
    expect(c.energy).toBe(100);
    expect(c.moveCooldown).toBe(0);

    // Enters ShallowWater -> 2x cost and moveCooldown = 1; next MOVE_E is blocked as STAY.
    expect(applyAction(world, c, Action.MOVE_E)).toBe(Action.MOVE_E);
    expect([c.x, c.y, c.moveCooldown]).toEqual([2, 0, 1]);
    expect(applyAction(world, c, Action.MOVE_E)).toBe(Action.STAY);
    expect([c.x, c.y, c.moveCooldown]).toEqual([2, 0, 0]);

    // Custom slowTileMoveCooldown = 0 and 2.
    const zeroCooldown = createWorld({
      preset: 'small',
      seed: 1,
      map,
      populate: false,
      config: { ...DEFAULT_CONFIG, creature: { ...cfg, slowTileMoveCooldown: 0 } },
    });
    const cz = zeroCooldown.spawnCreature(0, 0, 0)!;
    expect(applyAction(zeroCooldown, cz, Action.MOVE_E)).toBe(Action.MOVE_E);
    expect(cz.moveCooldown).toBe(0);
    expect(applyAction(zeroCooldown, cz, Action.MOVE_E)).toBe(Action.MOVE_E);

    const twoCooldown = createWorld({
      preset: 'small',
      seed: 1,
      map,
      populate: false,
      config: { ...DEFAULT_CONFIG, creature: { ...cfg, slowTileMoveCooldown: 2 } },
    });
    const ct = twoCooldown.spawnCreature(0, 0, 0)!;
    expect(applyAction(twoCooldown, ct, Action.MOVE_E)).toBe(Action.MOVE_E);
    expect(ct.moveCooldown).toBe(2);
    expect(applyAction(twoCooldown, ct, Action.MOVE_E)).toBe(Action.STAY);
    expect(applyAction(twoCooldown, ct, Action.MOVE_E)).toBe(Action.STAY);
    expect(applyAction(twoCooldown, ct, Action.MOVE_E)).toBe(Action.MOVE_E);
  });

  it('enforces EAT intake rules across full energy, partial need, scarce tile food, and empty tile', () => {
    const map = makeMiniMap([[Biome.Grass, Biome.Sand, Biome.Grass]], 30);
    map.maxFood[1] = 0;
    map.food[1] = 0; // Empty tile
    map.maxFood[2] = 5;
    map.food[2] = 5; // Less than eatBiteSize (20)
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 0, 0)!;

    // Full energy: EAT consumes 0 food and grants 0 foodEaten.
    expect(applyAction(world, c, Action.EAT)).toBe(Action.EAT);
    expect(c.stats.foodEaten).toBe(0);
    expect(world.getTileFood(0, 0)).toBe(30);

    // Partial need (< biteSize): consumes only exact need.
    c.energy = 90;
    expect(applyAction(world, c, Action.EAT)).toBe(Action.EAT);
    expect(c.energy).toBe(100);
    expect(world.getTileFood(0, 0)).toBe(20);
    expect(c.stats.foodEaten).toBeCloseTo(10 / DEFAULT_CONFIG.creature.eatBiteSize, 10);
    expect(world.getDepletedTileCount()).toBe(1);

    // Empty tile: EAT becomes STAY.
    world.moveCreature(c, 1, 0, Action.MOVE_E);
    expect(applyAction(world, c, Action.EAT)).toBe(Action.STAY);

    // Scarce tile food (5 < biteSize 20): consumes remaining 5 food.
    world.moveCreature(c, 2, 0, Action.MOVE_E);
    c.energy = 50;
    expect(applyAction(world, c, Action.EAT)).toBe(Action.EAT);
    expect(c.energy).toBe(55);
    expect(world.getTileFood(2, 0)).toBe(0);
  });

  it('enforces isWaterReachable and DRINK rules across DeepWater/ShallowWater and partial hydration', () => {
    const map = makeMiniMap([
      [Biome.DeepWater, Biome.Grass, Biome.Grass],
      [Biome.Grass, Biome.ShallowWater, Biome.Grass],
      [Biome.Grass, Biome.Grass, Biome.Grass],
    ]);
    // Bounds & NaN checks.
    expect(isWaterReachable(map.biomes, 3, 3, -1, 0)).toBe(false);
    expect(isWaterReachable(map.biomes, 3, 3, 3, 0)).toBe(false);
    expect(isWaterReachable(map.biomes, 3, 3, Number.NaN, 0)).toBe(false);
    // Diagonal only vs 4-adjacent N/E/S/W vs on water.
    expect(isWaterReachable(map.biomes, 3, 3, 2, 2)).toBe(false);
    expect(isWaterReachable(map.biomes, 3, 3, 1, 0)).toBe(true); // W to DeepWater, S to ShallowWater
    expect(isWaterReachable(map.biomes, 3, 3, 0, 1)).toBe(true); // N to DeepWater, E to ShallowWater
    expect(isWaterReachable(map.biomes, 3, 3, 2, 1)).toBe(true); // W to ShallowWater
    expect(isWaterReachable(map.biomes, 3, 3, 1, 2)).toBe(true); // N to ShallowWater
    expect(isWaterReachable(map.biomes, 3, 3, 1, 1)).toBe(true); // on ShallowWater

    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 2, 2)!;
    c.hydration = 50;

    // Diagonal from ShallowWater -> invalid DRINK becomes STAY.
    expect(applyAction(world, c, Action.DRINK)).toBe(Action.STAY);
    expect(c.hydration).toBe(50);

    // Move adjacent to ShallowWater -> DRINK succeeds.
    expect(applyAction(world, c, Action.MOVE_W)).toBe(Action.MOVE_W);
    expect(applyAction(world, c, Action.DRINK)).toBe(Action.DRINK);
    expect(c.hydration).toBe(50 + DEFAULT_CONFIG.creature.drinkBiteSize);
    expect(c.stats.waterDrunk).toBe(1);

    // Partial need (< drinkBiteSize 25).
    c.hydration = 90;
    expect(applyAction(world, c, Action.DRINK)).toBe(Action.DRINK);
    expect(c.hydration).toBe(100);
    expect(c.stats.waterDrunk).toBeCloseTo(1 + 10 / DEFAULT_CONFIG.creature.drinkBiteSize, 10);

    // Spam DRINK when full -> 0 extra waterDrunk.
    expect(applyAction(world, c, Action.DRINK)).toBe(Action.DRINK);
    expect(c.stats.waterDrunk).toBeCloseTo(1 + 10 / DEFAULT_CONFIG.creature.drinkBiteSize, 10);
  });

  it('resolves ATTACK and SHARE with nobody adjacent as STAY (rules: combat.test.ts)', () => {
    const map = makeMiniMap([[Biome.Grass, Biome.Grass]]);
    const world = createWorld({ preset: 'small', seed: 1, map, populate: false });
    const c = world.spawnCreature(0, 0, 0)!;
    expect(applyAction(world, c, Action.ATTACK)).toBe(Action.STAY);
    expect(applyAction(world, c, Action.SHARE)).toBe(Action.STAY);
  });
});
