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
  simVersion: 11,
  preset: 'small',
  seed: 42,
  mapHash: 'be9215703a745890',
  /** `world.hash()` after N ticks with the default random policy: tick rules only. */
  randomPolicy: {
    0: '847292cbd10c4481',
    100: 'bcb7442960d9fe2e',
    600: '4d92fc652049a1ef',
  },
  /**
   * `world.hash()` after N ticks with every creature driven by `goldenBrainGenome` of the default
   * brain (2 memory neurons since Sprint 3.5, 383 weights): adds the sensors, memory read-back, the
   * forward pass and the softsign-squashed memory outputs (the world hash covers memory). All 50
   * creatures have died by tick 600, so deaths are covered too.
   */
  brainPolicy: {
    100: 'f2c3492cee0729d5',
    600: '9087ac1ba1f22d3d',
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
    100: '427ab268562bb994',
    600: '5254f6288e0db199',
  },
  /**
   * `run.hash()` of `createEvolutionRun` (default config) when generation N starts: adds random
   * initial genomes, fitness, selection, crossover, mutation, tribe sizes, the benchmark arena
   * (generation 1) and the hall of fame.
   */
  evolution: {
    2: 'e0d2a3e9e2e23410',
    3: 'ca50dce930fc4042',
    4: 'c748d2d67fcd68d2',
  },
  /**
   * `world.hash()` of `brawlWorld()` (a 7×7 grass block packed with 3 tribes, random policy,
   * seed 42) after N ticks: adds combat (deaths inside Phase B, kill credit and loot), sharing and
   * territory. By tick 60: 23 kills, 8 valid shares, 23 of 37 creatures dead, territory
   * 42.9 / 40.8 / 16.3 %.
   */
  brawl: {
    20: '470b134939d42647',
    60: 'c8e86c6018cbc346',
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
