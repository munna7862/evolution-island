import {
  Action,
  brainSpecFromConfig,
  createBrainScratch,
  creatureFitness,
  forwardPass,
  memoryNeuronCount,
  readCallSensors,
  readSensors,
  SENSOR_COUNT,
  SensorIndex,
  type Creature,
  type World,
} from '@evolution-island/sim-core';

/**
 * Creature inspector data (plan §4 Sprint 6.2): what one creature is, senses and thinks right now.
 * Read-only on the world (sensors only rebuild the spatial grid, which every tick rebuilds anyway),
 * so inspecting never changes the simulation.
 */

export interface InspectedValue {
  readonly name: string;
  readonly value: number;
}

export interface CreatureInspection {
  readonly id: number;
  readonly tribeId: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly energy: number;
  readonly hydration: number;
  readonly age: number;
  /** World fitness so far this generation. */
  readonly fitness: number;
  /** The action it chose last tick and what it became after the rules. */
  readonly intent: string;
  readonly lastAction: string;
  readonly kills: number;
  readonly alliesHelped: number;
  readonly foodEaten: number;
  readonly waterDrunk: number;
  /** The brain's inputs now: sensors, then memory and call inputs if the brain has them. */
  readonly inputs: readonly InspectedValue[];
  readonly memory: readonly number[];
  readonly call: number;
  /** Activations of the brain on those inputs (null for creatures without a brain). */
  readonly hidden: readonly number[] | null;
  readonly outputs: readonly InspectedValue[] | null;
}

const ACTION_NAMES: readonly string[] = Object.keys(Action);
const SENSOR_NAMES: readonly string[] = Object.keys(SensorIndex)
  .sort(
    (a, b) =>
      SensorIndex[a as keyof typeof SensorIndex] - SensorIndex[b as keyof typeof SensorIndex],
  )
  .map((key) => key.toLowerCase().replaceAll('_', ' '));

export function actionName(action: number): string {
  return ACTION_NAMES[action] ?? String(action);
}

/**
 * Inspects a creature of `world`. With `brain` (the creature has a genome of the config's brain),
 * the inputs are built exactly as the brain policy builds them and run through the forward pass.
 */
export function inspectCreature(
  world: World,
  creature: Creature,
  brain: boolean,
): CreatureInspection {
  const config = world.config;
  const spec = brainSpecFromConfig(config);
  const signals = config.signals.enabled;
  const hasBrain = brain && creature.genome.length > 0;
  const inputs = new Float32Array(hasBrain ? spec.inputs : SENSOR_COUNT);
  readSensors(world, creature, inputs);
  const names = [...SENSOR_NAMES];
  let hidden: number[] | null = null;
  let outputs: InspectedValue[] | null = null;
  if (hasBrain) {
    const memory = memoryNeuronCount(spec, signals);
    inputs.set(creature.memory, SENSOR_COUNT);
    for (let k = 0; k < memory; k++) names.push(`memory ${k + 1}`);
    if (signals) {
      readCallSensors(world, creature, inputs, SENSOR_COUNT + memory);
      names.push('heard call', 'call dx', 'call dy');
    }
    const scratch = createBrainScratch(spec);
    const raw = forwardPass(spec, creature.genome, inputs, scratch);
    hidden = Array.from(scratch.hidden);
    const outputNames = [...ACTION_NAMES];
    for (let k = 0; k < memory; k++) outputNames.push(`memory ${k + 1}`);
    if (signals) outputNames.push('call');
    outputs = Array.from(raw, (value, i) => ({ name: outputNames[i] ?? `output ${i}`, value }));
  }
  return {
    id: creature.id,
    tribeId: creature.tribeId,
    alive: creature.alive,
    x: creature.x,
    y: creature.y,
    health: creature.health,
    energy: creature.energy,
    hydration: creature.hydration,
    age: creature.age,
    fitness: creatureFitness(creature.stats, config.evolution),
    intent: actionName(creature.intent),
    lastAction: actionName(creature.lastAction),
    kills: creature.stats.kills,
    alliesHelped: creature.stats.alliesHelped,
    foodEaten: creature.stats.foodEaten,
    waterDrunk: creature.stats.waterDrunk,
    inputs: Array.from(inputs, (value, i) => ({ name: names[i] ?? `input ${i}`, value })),
    memory: Array.from(creature.memory),
    call: creature.call,
    hidden,
    outputs,
  };
}

/**
 * A tribe's champion right now (Sprint 6.2 follow-cam): its living creature with the best world
 * fitness so far, ties → lowest id; null if none is alive.
 */
export function currentChampion(world: World, tribeId: number): Creature | null {
  let best: Creature | null = null;
  let bestFitness = Number.NEGATIVE_INFINITY;
  for (const c of world.creatures) {
    if (!c.alive || c.tribeId !== tribeId) continue;
    const f = creatureFitness(c.stats, world.config.evolution);
    if (f > bestFitness || (f === bestFitness && best !== null && c.id < best.id)) {
      best = c;
      bestFitness = f;
    }
  }
  return best;
}
