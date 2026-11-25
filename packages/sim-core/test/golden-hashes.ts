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
  simVersion: 10,
  preset: 'small',
  seed: 42,
  mapHash: 'be9215703a745890',
  /** `world.hash()` after N ticks with the default random policy: tick rules only. */
  randomPolicy: {
    0: 'ae3b8336483d0288',
    100: '762ac3f99274e6bc',
    600: '1904290e50c606fc',
  },
  /**
   * `world.hash()` after N ticks with every creature driven by `goldenBrainGenome` of the default
   * brain (2 memory neurons since Sprint 3.5, 383 weights): adds the sensors, memory read-back, the
   * forward pass and the softsign-squashed memory outputs (the world hash covers memory). All 50
   * creatures have died by tick 600, so deaths are covered too.
   */
  brainPolicy: {
    100: 'd5e3cccb8693ba2d',
    600: '2b5df2a43876ddb4',
  },
  /**
   * Running digest of every input vector (sensors + memory) and every raw forward-pass output
   * (float64 bits) of the `brainPolicy` scenario up to tick N. World hashes only see the argmax
   * and the float32 memory, so a last-bit difference in the forward pass would rarely reach them.
   */
  brainOutputs: {
    100: 'd647f1f5c0f85182',
    600: '554263a633d1ec7b',
  },
  /**
   * Like `brainPolicy` with memory switched off (`brain.memoryNeurons` 0: the Sprint 3.4 brain,
   * 18 → 12 → 9, 333 weights). 26 of the 50 creatures have died by tick 600 (all by 700).
   */
  noMemoryPolicy: {
    100: '8cbdabceac6afa8e',
    600: 'b449d4d13e4c041c',
  },
  /**
   * `run.hash()` of `createEvolutionRun` (default config) when generation N starts: adds random
   * initial genomes, fitness, selection, crossover, mutation, tribe sizes, the benchmark arena
   * (generation 1) and the hall of fame.
   */
  evolution: {
    2: '2ffe2bd27b697de9',
    3: '2efbe3c44ec5d4bc',
    4: 'b63e36b3aca38cbf',
  },
} as const;

/**
 * A fixed, closed-form genome (no RNG): weights spread over [-2, 2] in an irregular pattern.
 * On the golden map the 383-weight default brain mostly picks EAT and STAY, plus MOVE_E (the
 * 333-weight memory-off brain mostly DRINK/STAY); few moves succeed, so creatures rarely get far.
 * `brainOutputs` pins the raw outputs bit for bit.
 */
export function goldenBrainGenome(spec: BrainSpec): Float32Array {
  const weights = new Float32Array(weightCount(spec));
  for (let i = 0; i < weights.length; i++) {
    weights[i] = (((i * 7919) % 97) - 48) / 24;
  }
  return weights;
}
