import { Action } from './actions.js';
import type { CreatureConfig } from './config.js';

export const NO_MOVE_DIR = -1;

/** Genome of creatures driven by a non-brain policy (e.g. the random policy). */
export const EMPTY_GENOME: Float32Array = new Float32Array(0);

export interface CreatureStats {
  ticksAlive: number;
  foodEaten: number;
  waterDrunk: number;
  kills: number;
  alliesHelped: number;
  callsMade: number;
}

export interface Creature {
  readonly id: number;
  readonly tribeId: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  lastMoveDir: number;
  health: number;
  energy: number;
  hydration: number;
  age: number;
  alive: boolean;
  moveCooldown: number;
  intent: Action;
  lastAction: Action;
  readonly stats: CreatureStats;
  /** Brain weights (plan §2.4); `EMPTY_GENOME` when a non-brain policy drives the creature. */
  readonly genome: Float32Array;
  /**
   * Memory values (plan §2.3, Sprint 3.5), one per memory neuron (`config.brain.memoryNeurons`),
   * each within −1..1 and 0 at spawn. The brain policy writes them in Phase A and reads them back
   * as inputs on the next tick. Empty when memory is off.
   */
  readonly memory: Float32Array;
  /** This creature's call (0..1, 0 = silent) as allies hear it this tick (Sprint 4.3). */
  call: number;
  /** The call chosen in Phase A, heard from the next tick on. */
  nextCall: number;
}

export function createCreature(
  id: number,
  tribeId: number,
  x: number,
  y: number,
  config: CreatureConfig,
  genome: Float32Array = EMPTY_GENOME,
  memoryNeurons = 0,
): Creature {
  return {
    id,
    tribeId,
    x,
    y,
    prevX: x,
    prevY: y,
    lastMoveDir: NO_MOVE_DIR,
    health: config.maxHealth,
    energy: config.maxEnergy,
    hydration: config.maxHydration,
    age: 0,
    alive: true,
    moveCooldown: 0,
    intent: Action.STAY,
    lastAction: Action.STAY,
    stats: {
      ticksAlive: 0,
      foodEaten: 0,
      waterDrunk: 0,
      kills: 0,
      alliesHelped: 0,
      callsMade: 0,
    },
    genome,
    memory: new Float32Array(memoryNeurons),
    call: 0,
    nextCall: 0,
  };
}

/**
 * Applies one tick of metabolism in fixed order:
 * 1. Drain energy and hydration (clamped to >= 0).
 * 2. Drain health if starving or dehydrated; otherwise regenerate if both exceed regenThresholdRatio.
 * 3. Increment age and check death (`health <= 0`, or `age >= maxAge` when `maxAge > 0`).
 *
 * `stats.ticksAlive` increments only if the creature survives the tick.
 * Returns `true` if the creature died on this tick.
 */
export function applyMetabolism(
  creature: Creature,
  config: CreatureConfig,
  maxAge: number,
): boolean {
  if (!creature.alive) {
    return false;
  }

  creature.energy = Math.max(0, creature.energy - config.baseEnergyDrain);
  creature.hydration = Math.max(0, creature.hydration - config.baseHydrationDrain);

  const starving = creature.energy <= 0;
  const dehydrated = creature.hydration <= 0;

  if (starving || dehydrated) {
    let healthDrain = 0;
    if (starving) healthDrain += config.starvationHealthDrain;
    if (dehydrated) healthDrain += config.dehydrationHealthDrain;
    creature.health = Math.max(0, creature.health - healthDrain);
  } else if (
    creature.energy > config.maxEnergy * config.regenThresholdRatio &&
    creature.hydration > config.maxHydration * config.regenThresholdRatio &&
    creature.health > 0 &&
    creature.health < config.maxHealth
  ) {
    creature.health = Math.min(config.maxHealth, creature.health + config.healthRegenRate);
  }

  creature.age++;

  if (creature.health <= 0 || (maxAge > 0 && creature.age >= maxAge)) {
    creature.health = 0;
    creature.alive = false;
    return true;
  }

  creature.stats.ticksAlive++;
  return false;
}
