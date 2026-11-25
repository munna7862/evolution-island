import {
  Biome,
  createWorld,
  DEFAULT_CONFIG,
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
  simVersion: 14,
  preset: 'small',
  seed: 42,
  mapHash: 'be9215703a745890',
  /** `world.hash()` after N ticks with the default random policy: tick rules only. */
  randomPolicy: {
    0: '4f6e1990d43256eb',
    100: 'ad17350358b3939b',
    600: '1468dd8a948c8f67',
  },
  /**
   * `world.hash()` after N ticks with every creature driven by `goldenBrainGenome` of the default
   * brain (2 memory neurons since Sprint 3.5, 383 weights): adds the sensors, memory read-back, the
   * forward pass and the softsign-squashed memory outputs (the world hash covers memory). All 50
   * creatures have died by tick 600, so deaths are covered too.
   */
  brainPolicy: {
    100: 'a64ced87f66abd97',
    600: 'b00cdb46c652b539',
  },
  /**
   * Running digest of every input vector (sensors + memory) and every raw forward-pass output
   * (float64 bits) of the `brainPolicy` scenario up to tick N. World hashes only see the argmax
   * and the float32 memory, so a last-bit difference in the forward pass would rarely reach them.
   */
  brainOutputs: {
    100: 'd647f1f5c0f85182',
    600: '24e1f14920a420a7',
  },
  /**
   * Like `brainPolicy` with memory switched off (`brain.memoryNeurons` 0: the Sprint 3.4 brain,
   * 18 → 12 → 9, 333 weights). 25 of the 50 creatures have died by tick 600.
   */
  noMemoryPolicy: {
    100: '284c149c0f75eb05',
    600: '2ec5e76cb8b75f80',
  },
  /**
   * Like `brainPolicy` with signals on (`signals.enabled`, Sprint 4.3) and the 432-weight
   * `goldenBrainGenome` of that brain: adds the call output, call cost, the commit step and the
   * "loudest ally call" sensors. 3,287 creature-ticks of calling up to tick 600; 24 alive then.
   */
  signalsPolicy: {
    100: 'ff4d845177650871',
    600: '678f0f3fadeb6ab0',
  },
  /**
   * `run.hash()` of `createEvolutionRun` (default config) when generation N starts: adds random
   * initial genomes, fitness, selection, crossover, mutation, tribe sizes, the benchmark arena
   * (generation 1) and the hall of fame.
   */
  evolution: {
    2: '9e27bcd97764c435',
    3: '63b223a17f143ce1',
    4: '1b792f1c6a99fcf0',
  },
  /**
   * `world.hash()` of `brawlWorld()` (a 7×7 grass block packed with 3 tribes, random policy,
   * seed 42) after N ticks: adds combat (deaths inside Phase B, kill credit and loot), sharing and
   * territory. By tick 60: 23 kills, 8 valid shares, 23 of 37 creatures dead, territory
   * 42.9 / 40.8 / 16.3 %.
   */
  brawl: {
    20: 'c8ac08a95a1820eb',
    60: 'ef6f8a16920ab148',
  },
  /**
   * `world.hash()` of `climateWorld()` after N ticks (Sprint 7.2): frequent natural droughts and
   * floods, short years (winter from tick 300), the wandering food zone, and spectator events —
   * a flood, a drought and a winter — applied between ticks as replays apply them.
   */
  climate: {
    250: '45d279c73a494b11',
    800: '8208773b8bf7a239',
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

/** Spectator events of the `climate` scenario: applied after `tick` ticks. */
export const GOLDEN_CLIMATE_EVENTS = [
  { tick: 30, kind: 'flood', x: 20, y: 30 },
  { tick: 120, kind: 'drought', x: 32, y: 32 },
  { tick: 150, kind: 'foodZone', x: 40, y: 20 },
  { tick: 500, kind: 'winter', x: 0, y: 0 },
] as const;

/** The `climate` scenario: the golden map, random policy, climate turned up. */
export function climateWorld(): World {
  return createWorld({
    preset: 'small',
    seed: 42,
    policy: randomActionPolicy,
    config: {
      ...DEFAULT_CONFIG,
      climate: {
        ...DEFAULT_CONFIG.climate,
        yearLength: 400,
        disasterCheckInterval: 100,
        droughtChance: 0.6,
        floodChance: 0.6,
        droughtDuration: 250,
        floodDuration: 150,
        foodZoneMoveInterval: 50,
      },
    },
  });
}
