import {
  inputWeightIndex,
  outputBiasIndex,
  outputWeightIndex,
  validateBrainSpec,
  validateGenome,
  weightCount,
} from './brain.js';
import type { BrainSpec } from './brain.js';
import type { RngStream } from './rng.js';

/**
 * Genetic operators on flat genomes (plan §2.5). They draw only from the stream they are given
 * (the run's `rng.evolution`), and use only engine-exact arithmetic (plan §3.3).
 */

/** Uniform weights in [-range, range): generation 1 "knows nothing". */
export function randomGenome(spec: BrainSpec, rng: RngStream, range: number): Float32Array {
  const genome = new Float32Array(weightCount(spec));
  if (!(range > 0)) {
    return genome;
  }
  for (let i = 0; i < genome.length; i++) {
    genome[i] = rng.nextRange(-range, range);
  }
  return genome;
}

/**
 * Approximately standard-normal noise: the Irwin–Hall sum of 12 uniforms minus 6 (mean 0,
 * variance 1, bounded to ±6). Box–Muller would need `Math.log`/`Math.cos`, which differ between
 * JS engines (plan §3.3); this needs only additions.
 */
export function gaussian(rng: RngStream): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += rng.nextFloat();
  }
  return sum - 6;
}

/**
 * Per-hidden-neuron crossover (plan §2.5): for each hidden neuron, one coin flip decides which
 * parent supplies both its incoming and its outgoing weights; one more flip picks the parent of
 * the output biases, which belong to no hidden neuron.
 */
export function crossoverPerNeuron(
  spec: BrainSpec,
  a: Float32Array,
  b: Float32Array,
  rng: RngStream,
): Float32Array {
  const child = new Float32Array(weightCount(spec));
  for (let h = 0; h < spec.hidden; h++) {
    const parent = rng.nextUint32() & 1 ? b : a;
    const inStart = inputWeightIndex(spec, h, 0);
    child.set(parent.subarray(inStart, inStart + spec.inputs), inStart);
    const outStart = outputWeightIndex(spec, h, 0);
    child.set(parent.subarray(outStart, outStart + spec.outputs), outStart);
  }
  const biasParent = rng.nextUint32() & 1 ? b : a;
  const biasStart = outputBiasIndex(spec, 0);
  child.set(biasParent.subarray(biasStart, biasStart + spec.outputs), biasStart);
  return child;
}

/**
 * Genome migration (plan §2.4, CLAUDE.md): `weights` of a `from` brain as a `to` brain with more
 * inputs and/or outputs (appended after the existing ones, e.g. memory, Sprint 3.5) and the same
 * hidden layer. Every existing weight keeps its meaning; new inputs and outputs get weight 0, so
 * the actions come out exactly as before: a new input adds 0 to every hidden sum, a new output
 * adds nothing to the existing ones. Returns a new array; `weights` is not changed.
 */
export function migrateGenome(from: BrainSpec, to: BrainSpec, weights: Float32Array): Float32Array {
  validateBrainSpec(from);
  validateBrainSpec(to);
  validateGenome(from, weights);
  if (from.formatVersion !== to.formatVersion || from.hidden !== to.hidden) {
    throw new RangeError(
      `Cannot migrate a ${from.hidden}-hidden format-${from.formatVersion} genome to a ` +
        `${to.hidden}-hidden format-${to.formatVersion} brain`,
    );
  }
  if (to.inputs < from.inputs || to.outputs < from.outputs) {
    throw new RangeError(
      `Migration only adds inputs/outputs: ${from.inputs}→${to.inputs} inputs, ` +
        `${from.outputs}→${to.outputs} outputs`,
    );
  }
  const migrated = new Float32Array(weightCount(to));
  for (let h = 0; h < from.hidden; h++) {
    const fromIn = inputWeightIndex(from, h, 0);
    migrated.set(weights.subarray(fromIn, fromIn + from.inputs), inputWeightIndex(to, h, 0));
    const fromOut = outputWeightIndex(from, h, 0);
    migrated.set(weights.subarray(fromOut, fromOut + from.outputs), outputWeightIndex(to, h, 0));
  }
  const fromBias = outputBiasIndex(from, 0);
  migrated.set(weights.subarray(fromBias, fromBias + from.outputs), outputBiasIndex(to, 0));
  return migrated;
}

export interface MutationSettings {
  /** Chance per weight. */
  readonly rate: number;
  /** Standard deviation of the added noise. */
  readonly sigma: number;
  /** Every weight ends in [-clamp, clamp]. */
  readonly clamp: number;
}

/**
 * In place: each weight, with probability `rate`, gets Gaussian noise × `sigma`; every weight is
 * then clamped to ±`clamp`. One coin is drawn per weight, so the draw count is fixed per genome.
 */
export function mutateGenome(genome: Float32Array, rng: RngStream, m: MutationSettings): void {
  for (let i = 0; i < genome.length; i++) {
    let w = genome[i]!;
    if (rng.nextFloat() < m.rate) {
      w += gaussian(rng) * m.sigma;
    }
    genome[i] = Math.max(-m.clamp, Math.min(m.clamp, w));
  }
}
