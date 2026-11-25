import { ACTION_COUNT } from './actions.js';
import { brainPolicyForConfig, brainSpecFromConfig, validateGenome } from './brain.js';
import type { MapPresetId, SimConfig } from './config.js';
import { creatureFitness } from './fitness.js';
import { generateMap } from './map/generator.js';
import type { WorldMap } from './map/types.js';
import type { Creature } from './creature.js';
import { createWorld } from './world.js';

/**
 * Benchmark arena (plan §2.5): the "is it actually learning?" metric. Raw fitness rises and falls
 * with the arms race between tribes; the arena instead runs one genome in a fixed scenario —
 * a fixed-seed map of the run's preset, the genome cloned `startingCreaturesPerTribe` times into
 * tribe 0's start zone, alone, for one generation — and scores it by the clones' mean fitness.
 * Cloning averages out spawn luck, so the score measures the genome itself.
 */
export interface BenchmarkArena {
  readonly preset: MapPresetId;
  readonly config: SimConfig;
  /** Generated once from `config.evolution.benchmarkSeed`; each run copies its food layer. */
  readonly map: WorldMap;
}

export function createBenchmarkArena(preset: MapPresetId, config: SimConfig): BenchmarkArena {
  const map = generateMap({ preset, seed: config.evolution.benchmarkSeed, config });
  return { preset, config, map };
}

/** What a genome did in the arena. */
export interface BenchmarkResult {
  /** Mean fitness of the clones (the benchmark score). */
  readonly score: number;
  /**
   * Resolved actions of all living clones over the whole run, indexed by `Action` (an invalid
   * action counts as the `STAY` it became). The arena holds one tribe, so nobody is killed before
   * acting: every clone alive at a tick's start acts once in it.
   */
  readonly actions: readonly number[];
}

/**
 * The arena is a fixed yardstick (Sprint 7.2): no natural climate — no seasons, disasters or
 * food zone — so a champion's score never depends on where a flood happened to land.
 */
export function arenaConfig(config: SimConfig): SimConfig {
  return config.climate.enabled
    ? { ...config, climate: { ...config.climate, enabled: false } }
    : config;
}

/** Mean fitness of the genome's clones in the arena. Deterministic; uses no run RNG stream. */
export function runBenchmark(arena: BenchmarkArena, genome: Float32Array): number {
  return runBenchmarkDetailed(arena, genome).score;
}

/** `runBenchmark` plus the clones' action counts (Sprint 4.2: champions' action mix). */
export function runBenchmarkDetailed(arena: BenchmarkArena, genome: Float32Array): BenchmarkResult {
  const { preset, config, map } = arena;
  const spec = brainSpecFromConfig(config);
  validateGenome(spec, genome);
  const world = createWorld({
    preset,
    seed: config.evolution.benchmarkSeed,
    config: arenaConfig(config),
    map,
    populate: false,
    policy: brainPolicyForConfig(config, (c) => c.genome),
  });
  const clones = config.presets[preset].startingCreaturesPerTribe;
  const tribeId = map.spawnZones[0]!.tribeId;
  world.startGeneration(1, [{ tribeId, genomes: new Array<Float32Array>(clones).fill(genome) }]);
  const actions = new Array<number>(ACTION_COUNT).fill(0);
  const acting: Creature[] = [];
  while (!world.isGenerationOver()) {
    acting.length = 0;
    for (const c of world.creatures) {
      if (c.alive) acting.push(c);
    }
    world.tick();
    for (const c of acting) {
      actions[c.lastAction] = actions[c.lastAction]! + 1;
    }
  }
  let total = 0;
  for (const c of world.creatures) {
    total += creatureFitness(c.stats, config.evolution);
  }
  const score = world.creatures.length > 0 ? total / world.creatures.length : 0;
  return { score, actions };
}
