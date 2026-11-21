import type { SimConfig } from './config.js';
import type { Creature } from './creature.js';
import { isSlow, isWalkable, isWater, type WorldMap } from './map/types.js';

/**
 * All 9 action output slots exist from Phase 2 so genome layout never changes when combat/sharing
 * activate in Sprint 4.1 (plan §2.3, §2.4).
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
 * - Invalid actions (blocked moves, eating on empty tiles, drinking away from water) become `STAY`.
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

  // STAY, plus ATTACK and SHARE (act as STAY until Sprint 4.1 per plan §2.4).
  return Action.STAY;
}
