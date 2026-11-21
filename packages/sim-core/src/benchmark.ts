import { brainSpecFromConfig, createBrainPolicy, validateGenome } from './brain.js';
import type { MapPresetId, SimConfig } from './config.js';
import { creatureFitness } from './fitness.js';
import { generateMap } from './map/generator.js';
import type { WorldMap } from './map/types.js';
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

/** Mean fitness of the genome's clones in the arena. Deterministic; uses no run RNG stream. */
export function runBenchmark(arena: BenchmarkArena, genome: Float32Array): number {
  const { preset, config, map } = arena;
  const spec = brainSpecFromConfig(config);
  validateGenome(spec, genome);
  const world = createWorld({
    preset,
    seed: config.evolution.benchmarkSeed,
    config,
    map,
    populate: false,
    policy: createBrainPolicy(spec, (c) => c.genome),
  });
  const clones = config.presets[preset].startingCreaturesPerTribe;
  const tribeId = map.spawnZones[0]!.tribeId;
  world.startGeneration(1, [{ tribeId, genomes: new Array<Float32Array>(clones).fill(genome) }]);
  while (!world.isGenerationOver()) {
    world.tick();
  }
  let total = 0;
  for (const c of world.creatures) {
    total += creatureFitness(c.stats, config.evolution);
  }
  return world.creatures.length > 0 ? total / world.creatures.length : 0;
}
