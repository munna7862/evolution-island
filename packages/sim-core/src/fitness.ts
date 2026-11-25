import type { EvolutionConfig } from './config.js';
import type { Creature, CreatureStats } from './creature.js';

/**
 * Per-creature fitness (plan §2.5):
 * `w·ticksAlive + w·foodEaten + w·waterDrunk + w·min(alliesHelped, cap) + w·kills`.
 *
 * Exploit-proof by construction of the stats it reads: `foodEaten` / `waterDrunk` count energy and
 * hydration actually gained (÷ bite size), not EAT/DRINK actions; `alliesHelped` counts valid
 * SHAREs only and is capped per generation; dead creatures keep what they earned.
 */
export function creatureFitness(stats: CreatureStats, evolution: EvolutionConfig): number {
  const w = evolution.fitness;
  const helped = Math.min(stats.alliesHelped, Math.max(0, evolution.maxAlliesHelped));
  return (
    w.ticksAlive * stats.ticksAlive +
    w.foodEaten * stats.foodEaten +
    w.waterDrunk * stats.waterDrunk +
    w.alliesHelped * helped +
    w.kills * stats.kills
  );
}

export interface TribeOutcome {
  /** Members alive at generation end. */
  readonly survivors: number;
  /** Sum of the members' `foodEaten` (bites actually eaten). */
  readonly foodGathered: number;
  /** Territory % 0..100, averaged over the generation (plan §2.6, `World.territoryAverage`). */
  readonly territoryPct: number;
}

/**
 * Summarizes one tribe's members (sum in ascending id order, so the result is engine-exact) and
 * its territory % (`World.territoryAverage` since Sprint 4.2).
 */
export function tribeOutcome(members: readonly Creature[], territoryPct = 0): TribeOutcome {
  let survivors = 0;
  let foodGathered = 0;
  for (const c of members) {
    if (c.alive) survivors++;
    foodGathered += c.stats.foodEaten;
  }
  return { survivors, foodGathered, territoryPct };
}

/** Tribe score (plan §2.5, §2.6): survivors + food gathered + territory, weighted. */
export function tribeScore(outcome: TribeOutcome, evolution: EvolutionConfig): number {
  const w = evolution.tribeScore;
  return (
    w.survivors * outcome.survivors +
    w.foodGathered * outcome.foodGathered +
    w.territory * outcome.territoryPct
  );
}
