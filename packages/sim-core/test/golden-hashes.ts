import {
  Biome,
  createWorld,
  randomActionPolicy,
  weightCount,
  type BrainSpec,
  type World,
} from '../src/index.js';
import { makeMiniMap } from './mini-map.js';

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
  simVersion: 12,
  preset: 'small',
  seed: 42,
  mapHash: 'be9215703a745890',
  /** `world.hash()` after N ticks with the default random policy: tick rules only. */
  randomPolicy: {
    0: '3e27c3bdcedbaf4d',
    100: 'aba4012cdbbf330b',
    600: 'd7710dcaa799fe16',
  },
  /**
   * `world.hash()` after N ticks with every creature driven by `goldenBrainGenome` of the default
   * brain (2 memory neurons since Sprint 3.5, 383 weights): adds the sensors, memory read-back, the
   * forward pass and the softsign-squashed memory outputs (the world hash covers memory). All 50
   * creatures have died by tick 600, so deaths are covered too.
   */
  brainPolicy: {
    100: '5488f81fb2055db0',
    600: 'd93edd39000dde81',
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
    100: '52e2a87b927b2995',
    600: 'fa6c0c59063ae9cd',
  },
  /**
   * `run.hash()` of `createEvolutionRun` (default config) when generation N starts: adds random
   * initial genomes, fitness, selection, crossover, mutation, tribe sizes, the benchmark arena
   * (generation 1) and the hall of fame.
   */
  evolution: {
    2: 'e76966792889e82a',
    3: 'a2c2c974b3244977',
    4: 'f131367fe25bf86e',
  },
  /**
   * `world.hash()` of `brawlWorld()` (a 7×7 grass block packed with 3 tribes, random policy,
   * seed 42) after N ticks: adds combat (deaths inside Phase B, kill credit and loot), sharing and
   * territory. By tick 60: 23 kills, 8 valid shares, 23 of 37 creatures dead, territory
   * 42.9 / 40.8 / 16.3 %.
   */
  brawl: {
    20: 'b14816e3448a9492',
    60: '3f43301e737ff0b9',
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

/**
 * The `brawl` scenario: 37 creatures of tribes 0–2 on a 7×7 grass block (every 4th tile left
 * free), every 5th one starting hungry (energy 30) so valid shares happen, random policy.
 */
export function brawlWorld(): World {
  const map = makeMiniMap(Array.from({ length: 7 }, () => new Array<Biome>(7).fill(Biome.Grass)));
  const world = createWorld({
    preset: 'small',
    seed: 42,
    map,
    populate: false,
    policy: randomActionPolicy,
  });
  for (let i = 0; i < 49; i++) {
    if (i % 4 === 3) continue;
    const creature = world.spawnCreature(i % 3, i % 7, Math.floor(i / 7))!;
    if (i % 5 === 0) creature.energy = 30;
  }
  return world;
}
