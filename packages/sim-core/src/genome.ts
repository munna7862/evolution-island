import { inputWeightIndex, outputBiasIndex, outputWeightIndex, weightCount } from './brain.js';
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
