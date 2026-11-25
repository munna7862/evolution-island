import { Action, ACTION_COUNT } from './actions.js';
import type { SignalConfig, SimConfig } from './config.js';
import type { Creature } from './creature.js';
import { CALL_SENSOR_COUNT, readCallSensors, readSensors, SENSOR_COUNT } from './sensors.js';
import type { DecisionPolicy } from './world.js';

/**
 * Fixed-topology MLP brain (plan §2.4): inputs → one softsign hidden layer → linear outputs.
 *
 * Genome layout ("hidden-neuron-major"), for `I` inputs, `H` hidden neurons, `O` outputs:
 *
 *   [0, H·I)            hidden h's incoming weights at h·I + i (the bias input is just sensor
 *                       17, constant 1, so hidden neurons need no separate bias)
 *   [H·I, H·I + H·O)    hidden h's outgoing weights at H·I + h·O + o
 *   [H·I + H·O, +O)     output biases (the "+1 bias unit" of plan §2.4)
 *
 * Every hidden neuron's weights are two contiguous slices, so per-neuron crossover (Sprint 3.2) is
 * two slice copies. Total = H·I + (H + 1)·O: 18 → 12 → 9 gives 333 weights.
 *
 * Memory (plan §2.3, Sprint 3.5): with M memory neurons the inputs are the 18 sensors followed by
 * the M memory values, and the outputs the 9 actions followed by the M memory outputs, so a
 * memory-off genome migrates by appending zero weights (`migrateGenome`). 20 → 12 → 11 (M = 2)
 * gives 383 weights.
 */

/** Bump when the network layout or activation changes (e.g. NEAT would be 2). */
export const BRAIN_FORMAT_VERSION = 1;

export interface BrainSpec {
  readonly formatVersion: number;
  /** The SENSOR_COUNT sensors (including the constant bias, sensor 17), then the memory inputs. */
  readonly inputs: number;
  readonly hidden: number;
  /** The first ACTION_COUNT outputs are the actions, then the memory outputs (calls: 4.3). */
  readonly outputs: number;
}

export interface BrainScratch {
  readonly hidden: Float64Array;
  readonly outputs: Float64Array;
}

const ACTION_BY_INDEX: readonly Action[] = [
  Action.MOVE_N,
  Action.MOVE_E,
  Action.MOVE_S,
  Action.MOVE_W,
  Action.STAY,
  Action.EAT,
  Action.DRINK,
  Action.ATTACK,
  Action.SHARE,
];

/** Call outputs when signals are on (Sprint 4.3): one, after the memory outputs. */
export const CALL_OUTPUT_COUNT = 1;

export function brainSpecFromConfig(config: SimConfig): BrainSpec {
  const memory = config.brain.memoryNeurons;
  if (!Number.isSafeInteger(memory) || memory < 0) {
    throw new RangeError(`brain.memoryNeurons must be a whole number ≥ 0, got ${memory}`);
  }
  const signals = config.signals.enabled;
  return {
    formatVersion: BRAIN_FORMAT_VERSION,
    inputs: SENSOR_COUNT + memory + (signals ? CALL_SENSOR_COUNT : 0),
    hidden: config.brain.hiddenNeurons,
    outputs: ACTION_COUNT + memory + (signals ? CALL_OUTPUT_COUNT : 0),
  };
}

/**
 * Memory neurons of a brain spec: its inputs beyond the sensors (and the call inputs, when
 * `signals`), which must match its outputs beyond the actions (and the call output). Throws for
 * a spec the creature brain can't run. Sizes alone can't tell whether a brain has signals, so the
 * caller says (from its config).
 */
export function memoryNeuronCount(spec: BrainSpec, signals = false): number {
  const memoryInputs = spec.inputs - SENSOR_COUNT - (signals ? CALL_SENSOR_COUNT : 0);
  const memoryOutputs = spec.outputs - ACTION_COUNT - (signals ? CALL_OUTPUT_COUNT : 0);
  if (memoryInputs < 0) {
    throw new RangeError(`Brain has ${spec.inputs} inputs, needs at least ${SENSOR_COUNT}`);
  }
  if (memoryOutputs < 0) {
    throw new RangeError(`Brain has ${spec.outputs} outputs, needs at least ${ACTION_COUNT}`);
  }
  if (memoryInputs !== memoryOutputs) {
    throw new RangeError(
      `Brain has ${memoryInputs} memory inputs but ${memoryOutputs} memory outputs ` +
        `(${spec.inputs} inputs, ${spec.outputs} outputs)`,
    );
  }
  return memoryInputs;
}

function isPositiveInt(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateBrainSpec(spec: BrainSpec): void {
  if (spec.formatVersion !== BRAIN_FORMAT_VERSION) {
    throw new RangeError(
      `Unsupported brain formatVersion ${spec.formatVersion} (expected ${BRAIN_FORMAT_VERSION})`,
    );
  }
  if (!isPositiveInt(spec.inputs) || !isPositiveInt(spec.hidden) || !isPositiveInt(spec.outputs)) {
    throw new RangeError(
      `Brain spec sizes must be positive integers, got ${spec.inputs}-${spec.hidden}-${spec.outputs}`,
    );
  }
}

export function sameBrainSpec(a: BrainSpec, b: BrainSpec): boolean {
  return (
    a.formatVersion === b.formatVersion &&
    a.inputs === b.inputs &&
    a.hidden === b.hidden &&
    a.outputs === b.outputs
  );
}

export function weightCount(spec: BrainSpec): number {
  return spec.hidden * spec.inputs + (spec.hidden + 1) * spec.outputs;
}

/** Index of the weight from input `i` into hidden neuron `h`. */
export function inputWeightIndex(spec: BrainSpec, h: number, i: number): number {
  return h * spec.inputs + i;
}

/** Index of the weight from hidden neuron `h` into output `o`. */
export function outputWeightIndex(spec: BrainSpec, h: number, o: number): number {
  return spec.hidden * spec.inputs + h * spec.outputs + o;
}

/** Index of output `o`'s bias. */
export function outputBiasIndex(spec: BrainSpec, o: number): number {
  return spec.hidden * spec.inputs + spec.hidden * spec.outputs + o;
}

/** A genome with every weight 0 (all outputs 0, so argmax picks MOVE_N). */
export function createZeroGenome(spec: BrainSpec): Float32Array {
  validateBrainSpec(spec);
  return new Float32Array(weightCount(spec));
}

/** Throws unless `weights` has exactly the spec's weight count and every weight is finite. */
export function validateGenome(spec: BrainSpec, weights: Float32Array): void {
  const expected = weightCount(spec);
  if (weights.length !== expected) {
    throw new RangeError(`Genome has ${weights.length} weights, brain spec needs ${expected}`);
  }
  for (let i = 0; i < weights.length; i++) {
    if (!Number.isFinite(weights[i]!)) {
      throw new RangeError(`Genome weight ${i} is not finite (${weights[i]!})`);
    }
  }
}

export function createBrainScratch(spec: BrainSpec): BrainScratch {
  validateBrainSpec(spec);
  return { hidden: new Float64Array(spec.hidden), outputs: new Float64Array(spec.outputs) };
}

/** Softsign `x / (1 + |x|)`: a tanh-like squash in (-1, 1) using only engine-exact operations. */
export function softsign(x: number): number {
  return x / (1 + Math.abs(x));
}

/**
 * Runs the network and returns `scratch.outputs` (action outputs first, linear).
 * Allocation-free. Sums run in a fixed order (inputs ascending; hidden ascending, then the bias),
 * in float64, so every engine produces identical bits (plan §3.3).
 */
export function forwardPass(
  spec: BrainSpec,
  weights: Float32Array,
  inputs: ArrayLike<number>,
  scratch: BrainScratch,
): Float64Array {
  const nIn = spec.inputs;
  const nHid = spec.hidden;
  const nOut = spec.outputs;
  const hidden = scratch.hidden;
  const outputs = scratch.outputs;

  let w = 0;
  for (let h = 0; h < nHid; h++) {
    let sum = 0;
    for (let i = 0; i < nIn; i++) {
      sum += weights[w + i]! * inputs[i]!;
    }
    w += nIn;
    hidden[h] = sum / (1 + Math.abs(sum));
  }

  for (let o = 0; o < nOut; o++) {
    outputs[o] = 0;
  }
  for (let h = 0; h < nHid; h++) {
    const activation = hidden[h]!;
    for (let o = 0; o < nOut; o++) {
      outputs[o] = outputs[o]! + activation * weights[w + o]!;
    }
    w += nOut;
  }
  for (let o = 0; o < nOut; o++) {
    outputs[o] = outputs[o]! + weights[w + o]!;
  }

  return outputs;
}

/**
 * Picks the action with the highest output among the first ACTION_COUNT outputs.
 * Ties go to the lowest index; NaN never wins; if nothing beats -Infinity, returns STAY.
 */
export function argmaxAction(outputs: ArrayLike<number>): Action {
  let best = Number.NEGATIVE_INFINITY;
  let bestIndex = -1;
  for (let i = 0; i < ACTION_COUNT; i++) {
    const value = outputs[i]!;
    if (value > best) {
      best = value;
      bestIndex = i;
    }
  }
  return bestIndex === -1 ? Action.STAY : ACTION_BY_INDEX[bestIndex]!;
}

/**
 * Stores the memory outputs (the outputs after the ACTION_COUNT actions) squashed with softsign,
 * so every stored value is within −1..1 (plan §2.3). `memory.length` says how many there are.
 */
export function storeMemoryOutputs(outputs: ArrayLike<number>, memory: Float32Array): void {
  for (let k = 0; k < memory.length; k++) {
    memory[k] = softsign(outputs[ACTION_COUNT + k]!);
  }
}

/**
 * Decision policy that feeds each creature's 18 sensors (then its memory values, if the brain has
 * memory) through its genome and picks the argmax action. With memory it also stores the squashed
 * memory outputs as the creature's memory, read back on the next tick (plan §2.3): a creature only
 * reads its own memory, and reads it before writing it, so the update order inside Phase A does
 * not matter. Pure: it ignores the policy RNG stream. `genomeFor` supplies each creature's weights
 * (Sprint 3.2 gives every creature its own genome from its tribe's gene pool).
 * Genomes are length-checked per call; validate their values once with `validateGenome`.
 */
/**
 * The call a creature makes from its raw call output (Sprint 4.3): `max(0, softsign(x))`, so
 * 0..1, and 0 (silent) below `callThreshold`. A zero-weight output gives 0: a migrated genome
 * never calls.
 */
export function callValue(output: number, callThreshold: number): number {
  const call = Math.max(0, softsign(output));
  return call >= callThreshold ? call : 0;
}

export function createBrainPolicy(
  spec: BrainSpec,
  genomeFor: (creature: Creature) => Float32Array,
  signals?: SignalConfig,
): DecisionPolicy {
  validateBrainSpec(spec);
  const hasSignals = signals?.enabled === true;
  const memorySize = memoryNeuronCount(spec, hasSignals);
  const callInputs = SENSOR_COUNT + memorySize;
  const callOutput = ACTION_COUNT + memorySize;
  const callThreshold = signals?.callThreshold ?? 0;

  const expectedWeights = weightCount(spec);
  const inputs = new Float32Array(spec.inputs);
  const scratch = createBrainScratch(spec);

  return (world, creature) => {
    const genome = genomeFor(creature);
    if (genome.length !== expectedWeights) {
      throw new RangeError(
        `Creature ${creature.id} genome has ${genome.length} weights, brain spec needs ${expectedWeights}`,
      );
    }
    const memory = creature.memory;
    if (memory.length !== memorySize) {
      throw new RangeError(
        `Creature ${creature.id} has ${memory.length} memory values, brain spec needs ${memorySize}`,
      );
    }
    readSensors(world, creature, inputs);
    inputs.set(memory, SENSOR_COUNT);
    if (hasSignals) readCallSensors(world, creature, inputs, callInputs);
    const outputs = forwardPass(spec, genome, inputs, scratch);
    storeMemoryOutputs(outputs, memory);
    if (hasSignals) creature.nextCall = callValue(outputs[callOutput]!, callThreshold);
    return argmaxAction(outputs);
  };
}

/** `createBrainPolicy` for a config's brain (memory and signals as the config says). */
export function brainPolicyForConfig(
  config: SimConfig,
  genomeFor: (creature: Creature) => Float32Array,
): DecisionPolicy {
  return createBrainPolicy(brainSpecFromConfig(config), genomeFor, config.signals);
}
