import type { SimConfig } from './config.js';
import type { Creature } from './creature.js';
import { isSlow, isWalkable, isWater, type WorldMap } from './map/types.js';

/**
 * All 9 action output slots exist from Phase 2 so the genome layout did not change when combat and
 * sharing became active in Sprint 4.1 (plan §2.3, §2.4).
 */
export const Action = {
  MOVE_N: 0,
  MOVE_E: 1,
  MOVE_S: 2,
  MOVE_W: 3,
  STAY: 4,
  EAT: 5,
  DRINK: 6,
  ATTACK: 7,
  SHARE: 8,
} as const;

export type Action = (typeof Action)[keyof typeof Action];

export const ACTION_COUNT = 9;

export const ACTION_DX: readonly [number, number, number, number] = [0, 1, 0, -1];
export const ACTION_DY: readonly [number, number, number, number] = [-1, 0, 1, 0];

export interface ActionWorldContext {
  readonly map: WorldMap;
  readonly config: SimConfig;
  isTileEmpty(x: number, y: number): boolean;
  moveCreature(creature: Creature, nx: number, ny: number, dir: Action): void;
  getTileFood(x: number, y: number): number;
  consumeFood(x: number, y: number, amount: number): number;
  /** The living creature standing on (x, y), if any. */
  creatureAt(x: number, y: number): Creature | undefined;
  /** Removes a creature killed by an `ATTACK` from the world at once (inside Phase B). */
  killCreature(victim: Creature): void;
}

/**
 * The living neighbour (8-neighbourhood) of `creature` from its own tribe (`allies`) or another
 * tribe with the lowest `key`, ties → lowest id (plan §2.3, CLAUDE.md "break every tie by id").
 */
function lowestNeighbour(
  world: ActionWorldContext,
  creature: Creature,
  allies: boolean,
  key: (other: Creature) => number,
): Creature | undefined {
  let best: Creature | undefined;
  let bestKey = Number.POSITIVE_INFINITY;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const other = world.creatureAt(creature.x + dx, creature.y + dy);
      if (other === undefined || (other.tribeId === creature.tribeId) !== allies) continue;
      const k = key(other);
      if (best === undefined || k < bestKey || (k === bestKey && other.id < best.id)) {
        best = other;
        bestKey = k;
      }
    }
  }
  return best;
}

/**
 * `ATTACK` (plan §2.3): hits the adjacent enemy with the lowest health for `attackDamage`, at
 * `attackEnergyCost`. A victim at 0 health dies at once; the killing blow gets the kill and
 * `killEnergyFraction` of the victim's remaining energy. No adjacent enemy → `STAY`.
 */
function applyAttack(world: ActionWorldContext, creature: Creature): Action {
  const target = lowestNeighbour(world, creature, false, (c) => c.health);
  if (target === undefined) {
    return Action.STAY;
  }
  const cfg = world.config.creature;
  creature.energy = Math.max(0, creature.energy - cfg.attackEnergyCost);
  target.health = Math.max(0, target.health - Math.max(0, cfg.attackDamage));
  if (target.health <= 0) {
    const loot = Math.max(0, cfg.killEnergyFraction) * target.energy;
    creature.energy = Math.min(cfg.maxEnergy, creature.energy + loot);
    creature.stats.kills++;
    world.killCreature(target);
  }
  return Action.ATTACK;
}

/**
 * `SHARE` (plan §2.3): gives `shareAmount` energy to the adjacent ally with the lowest energy, who
 * gains it at `shareEfficiency`, only if that ally is below `shareNeedRatio` of max energy and the
 * giver keeps at least `shareKeepRatio` of max energy (Sprint 4.1: without the second rule two
 * hungry allies could pass energy back and forth for fitness). Counts one `alliesHelped`.
 * Otherwise `STAY`.
 */
function applyShare(world: ActionWorldContext, creature: Creature): Action {
  const target = lowestNeighbour(world, creature, true, (c) => c.energy);
  const cfg = world.config.creature;
  const amount = cfg.shareAmount;
  if (
    target === undefined ||
    !(amount > 0) ||
    !(target.energy < cfg.shareNeedRatio * cfg.maxEnergy) ||
    !(creature.energy - amount >= cfg.shareKeepRatio * cfg.maxEnergy)
  ) {
    return Action.STAY;
  }
  creature.energy -= amount;
  target.energy = Math.min(
    cfg.maxEnergy,
    target.energy + amount * Math.max(0, cfg.shareEfficiency),
  );
  creature.stats.alliesHelped++;
  return Action.SHARE;
}

/**
 * Returns `true` when (x, y) is a water tile or 4-adjacent to any water tile (plan §2.1).
 */
export function isWaterReachable(
  biomes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= width || y < 0 || y >= height) {
    return false;
  }
  const idx = y * width + x;
  if (isWater(biomes[idx]!)) return true;
  if (x > 0 && isWater(biomes[idx - 1]!)) return true;
  if (x + 1 < width && isWater(biomes[idx + 1]!)) return true;
  if (y > 0 && isWater(biomes[idx - width]!)) return true;
  if (y + 1 < height && isWater(biomes[idx + width]!)) return true;
  return false;
}

/**
 * Resolves a single creature's chosen action intent against the world rules.
 *
 * - Invalid actions (blocked moves, eating on empty tiles, drinking away from water, `ATTACK`
 *   with no adjacent enemy, `SHARE` with no adjacent ally in need or no energy to spare) become
 *   `STAY`.
 * - Moving when `energy === 0` is allowed (energy clamps to `0` while starvation drains health).
 * - `EAT`/`DRINK` when already at max energy/hydration still return `EAT`/`DRINK`, consume no
 *   resources, and grant `0` intake credit (preventing fitness farming, plan §2.5).
 * - Non-move actions execute normally during slow-tile `moveCooldown` and still decrement cooldown.
 */
export function applyAction(world: ActionWorldContext, creature: Creature, intent: Action): Action {
  if (!creature.alive) {
    return Action.STAY;
  }

  const canMove = creature.moveCooldown <= 0;
  if (creature.moveCooldown > 0) {
    creature.moveCooldown = Math.max(0, creature.moveCooldown - 1);
  }

  const cfg = world.config.creature;
  const { map } = world;

  if (
    intent === Action.MOVE_N ||
    intent === Action.MOVE_E ||
    intent === Action.MOVE_S ||
    intent === Action.MOVE_W
  ) {
    if (!canMove) {
      return Action.STAY;
    }

    const dx = ACTION_DX[intent];
    const dy = ACTION_DY[intent];
    const nx = creature.x + dx;
    const ny = creature.y + dy;

    if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) {
      return Action.STAY;
    }

    const targetBiome = map.biomes[ny * map.width + nx]!;
    if (!isWalkable(targetBiome) || !world.isTileEmpty(nx, ny)) {
      return Action.STAY;
    }

    world.moveCreature(creature, nx, ny, intent);
    const slow = isSlow(targetBiome);
    const energyCost = slow ? cfg.moveEnergyCost * cfg.slowTileMoveMultiplier : cfg.moveEnergyCost;
    creature.energy = Math.max(0, creature.energy - energyCost);
    if (slow) {
      creature.moveCooldown = Math.max(0, Math.floor(cfg.slowTileMoveCooldown));
    }
    return intent;
  }

  if (intent === Action.EAT) {
    const tileFood = world.getTileFood(creature.x, creature.y);
    if (tileFood <= 0) {
      return Action.STAY;
    }
    const prevEnergy = creature.energy;
    const need = Math.max(0, cfg.maxEnergy - prevEnergy);
    const requested = Math.min(cfg.eatBiteSize, tileFood, need);
    if (requested > 0) {
      const eaten = world.consumeFood(creature.x, creature.y, requested);
      const nextEnergy = Math.min(cfg.maxEnergy, prevEnergy + eaten);
      creature.energy = nextEnergy;
      const gained = nextEnergy - prevEnergy;
      if (gained > 0 && cfg.eatBiteSize > 0) {
        creature.stats.foodEaten += gained / cfg.eatBiteSize;
      }
    }
    return Action.EAT;
  }

  if (intent === Action.DRINK) {
    if (!isWaterReachable(map.biomes, map.width, map.height, creature.x, creature.y)) {
      return Action.STAY;
    }
    const prevHydration = creature.hydration;
    const need = Math.max(0, cfg.maxHydration - prevHydration);
    const drunk = Math.min(cfg.drinkBiteSize, need);
    if (drunk > 0) {
      const nextHydration = Math.min(cfg.maxHydration, prevHydration + drunk);
      creature.hydration = nextHydration;
      const gained = nextHydration - prevHydration;
      if (gained > 0 && cfg.drinkBiteSize > 0) {
        creature.stats.waterDrunk += gained / cfg.drinkBiteSize;
      }
    }
    return Action.DRINK;
  }

  if (intent === Action.ATTACK) {
    return applyAttack(world, creature);
  }

  if (intent === Action.SHARE) {
    return applyShare(world, creature);
  }

  return Action.STAY;
}
