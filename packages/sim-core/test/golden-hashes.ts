import { weightCount, type BrainSpec } from '../src/index.js';

/**
 * Golden state hashes for fixed scenarios, checked by golden-hash.test.ts in Node (`pnpm test`)
 * and inside Chromium (`pnpm test:browser`), and by the viewer's Playwright suite through the real
 * Web Worker. Together they prove Node and the browser simulate bit-for-bit the same world, which
 * replays and trainer runs rely on.
 *
 * If a test against these values fails, simulation behaviour changed. That is only allowed
 * together with a SIM_VERSION bump (CLAUDE.md): bump it in src/version.ts, then update
 * `simVersion` and the hashes below in the same commit. Never update the hashes alone.
 */
export const GOLDEN = {
  simVersion: 9,
  preset: 'small',
  seed: 42,
  mapHash: 'be9215703a745890',
  /** `world.hash()` after N ticks with the default random policy: tick rules only. */
  randomPolicy: {
    0: '1d18ff3713b139b4',
    100: '170b70f0615397e2',
    600: '664d63175174e426',
  },
  /**
   * `world.hash()` after N ticks with every creature driven by `goldenBrainGenome`: adds the
   * sensors and the forward pass. 26 of the 50 creatures have died by tick 600 (all by 700), so deaths
   * are covered too.
   */
  brainPolicy: {
    100: '0174cc2134f12839',
    600: '5d4fb6b17ea33f9e',
  },
  /**
   * Running digest of every sensor vector and every raw forward-pass output (float64 bits) of the
   * `brainPolicy` scenario up to tick N. World hashes only see the argmax, and this genome mostly
   * chooses DRINK/STAY, so a last-bit difference in the forward pass would rarely reach them.
   */
  brainOutputs: {
    100: '6dac8da5d2b503a3',
    600: '43c46f7b4e57eff9',
  },
  /**
   * Like `brainPolicy`, but with 2 memory neurons (`brain.memoryNeurons` 2, Sprint 3.5) and the
   * 383-weight `goldenBrainGenome` of that brain: adds memory read-back and the softsign-squashed
   * memory outputs, which the world hash covers. Almost every memory value differs (≈ 52,000
   * distinct float32 values up to tick 600, |value| ≤ 0.86); all 50 creatures are dead by 600.
   */
  memoryPolicy: {
    100: '7781e3332ff3711f',
    600: '26b909ea37008459',
  },
  /**
   * `run.hash()` of `createEvolutionRun` (default config) when generation N starts: adds random
   * initial genomes, fitness, selection, crossover, mutation, tribe sizes, the benchmark arena
   * (generation 1) and the hall of fame.
   */
  evolution: {
    2: '2d4577fbc5a1febb',
    3: 'ca4466ae5751de75',
    4: '88b64e4cb5f44f8f',
  },
} as const;

/**
 * A fixed, closed-form genome (no RNG): weights spread over [-2, 2] in an irregular pattern.
 * On the golden map it picks DRINK most of the time, plus EAT, MOVE_E, MOVE_W and ATTACK, and
 * rarely gets far (few moves succeed); `brainOutputs` pins its raw outputs bit for bit.
 */
export function goldenBrainGenome(spec: BrainSpec): Float32Array {
  const weights = new Float32Array(weightCount(spec));
  for (let i = 0; i < weights.length; i++) {
    weights[i] = (((i * 7919) % 97) - 48) / 24;
  }
  return weights;
}
