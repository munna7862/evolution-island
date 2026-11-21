import { describe, expect, it } from 'vitest';
import {
  Action,
  addToHallOfFame,
  allocateTribeSizes,
  breedGenomes,
  brainSpecFromConfig,
  createBenchmarkArena,
  createCreature,
  createEvolutionRun,
  createRngStream,
  createWorld,
  createZeroGenome,
  DEFAULT_CONFIG,
  EMPTY_GENOME,
  inputWeightIndex,
  isBenchmarkGeneration,
  outputBiasIndex,
  outputWeightIndex,
  pickParent,
  rankByFitness,
  runBenchmark,
  SensorIndex,
  weightCount,
  type EvolutionConfig,
  type EvolutionRun,
  type HallOfFameEntry,
  type MapPreset,
  type SimConfig,
} from '../src/index.js';

const EVO = DEFAULT_CONFIG.evolution;
const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);

/** Small-preset config with overrides (short generations keep runs fast). */
function smallConfig(preset: Partial<MapPreset>, evolution: Partial<EvolutionConfig> = {}) {
  const config: SimConfig = {
    ...DEFAULT_CONFIG,
    presets: { ...DEFAULT_CONFIG.presets, small: { ...DEFAULT_CONFIG.presets.small, ...preset } },
    evolution: { ...EVO, ...evolution },
  };
  return config;
}

function genomeOf(value: number): Float32Array {
  return new Float32Array(weightCount(SPEC)).fill(value);
}

/** Sets every living member's health to 0, so they die in this tick's metabolism. */
function doomTribe(run: EvolutionRun, tribeId: number): void {
  for (const c of run.world.creatures) {
    if (c.alive && c.tribeId === tribeId) c.health = 0;
  }
}

function tribeGenomes(run: EvolutionRun, tribeId: number): Float32Array[] {
  return run.world.creatures.filter((c) => c.tribeId === tribeId).map((c) => c.genome);
}

describe('rankByFitness', () => {
  it('sorts best first, ties to the lower id, and keeps dead creatures', () => {
    const make = (id: number, ticksAlive: number, alive: boolean) => {
      const c = createCreature(id, 0, 0, 0, DEFAULT_CONFIG.creature, genomeOf(id));
      c.stats.ticksAlive = ticksAlive;
      c.alive = alive;
      return c;
    };
    const ranked = rankByFitness(
      [make(3, 10, true), make(1, 50, false), make(2, 10, true), make(0, 5, true)],
      EVO,
    );
    expect(ranked.map((r) => r.id)).toEqual([1, 2, 3, 0]);
    expect(ranked[0]!.fitness).toBe(50);
  });
});

describe('pickParent', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => genomeOf(i));

  it('truncation picks only from the top parentFraction', () => {
    const rng = createRngStream('trunc');
    const picked = new Set<number>();
    for (let i = 0; i < 500; i++) picked.add(pickParent(candidates, EVO, rng)[0]!);
    expect([...picked].sort()).toEqual([0, 1]); // 20% of 10
  });

  it('tournament favours better ranks but can pick any', () => {
    const rng = createRngStream('tourn');
    const evo: EvolutionConfig = { ...EVO, selection: 'tournament', tournamentSize: 3 };
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 3000; i++) counts[pickParent(candidates, evo, rng)[0]!]!++;
    expect(counts[0]!).toBeGreaterThan(counts[3]!);
    expect(counts[3]!).toBeGreaterThan(counts[6]!);
    // Unlike truncation (top 2 only), ranks below the cut still get picked.
    expect(counts.slice(2, 8).every((n) => n > 0)).toBe(true);
  });

  it('refuses an empty pool', () => {
    expect(() => pickParent([], EVO, createRngStream('x'))).toThrow(RangeError);
  });
});

describe('breedGenomes', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => genomeOf(i / 10));

  it('copies the elites unchanged and fills the rest with mutated offspring', () => {
    const next = breedGenomes(SPEC, candidates, 25, EVO, createRngStream('breed'));
    expect(next).toHaveLength(25);
    expect(next[0]).toEqual(candidates[0]);
    expect(next[1]).toEqual(candidates[1]);
    expect(next[0]).not.toBe(candidates[0]);
    for (const child of next.slice(2)) {
      expect(child).toHaveLength(weightCount(SPEC));
      expect(Math.max(...child)).toBeLessThanOrEqual(EVO.weightClamp);
      expect(Math.min(...child)).toBeGreaterThanOrEqual(-EVO.weightClamp);
    }
  });

  it('with crossover off, each child is a mutated copy of one top parent', () => {
    const evo: EvolutionConfig = { ...EVO, crossover: false, eliteCount: 0 };
    const next = breedGenomes(SPEC, candidates, 20, evo, createRngStream('mut-only'));
    for (const child of next) {
      // Most weights are untouched, and those equal one of the two truncation parents (0, 0.1).
      const counts = new Map<number, number>();
      for (const w of child) counts.set(w, (counts.get(w) ?? 0) + 1);
      const [mode] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]!;
      expect([0, Math.fround(0.1)]).toContain(mode);
      expect(counts.get(mode)!).toBeGreaterThan(weightCount(SPEC) * 0.8);
    }
  });

  it('is reproducible, and falls back to random genomes with no candidates', () => {
    const a = breedGenomes(SPEC, candidates, 8, EVO, createRngStream('same'));
    const b = breedGenomes(SPEC, candidates, 8, EVO, createRngStream('same'));
    expect(a).toEqual(b);
    const fresh = breedGenomes(SPEC, [], 3, EVO, createRngStream('fresh'));
    expect(fresh).toHaveLength(3);
    expect(Math.max(...fresh[0]!)).toBeLessThan(EVO.initialWeightRange);
    expect(fresh[0]).not.toEqual(fresh[1]);
  });
});

describe('allocateTribeSizes', () => {
  const share = (score: number) => ({ kind: 'share' as const, score });

  it('splits the budget in proportion to tribe score', () => {
    expect(allocateTribeSizes([share(2), share(1), share(1)], 200, 25, 100)).toEqual([100, 50, 50]);
  });

  it('clamps to [min, popCap] and re-splits the rest', () => {
    expect(allocateTribeSizes([share(3), share(1)], 200, 25, 100)).toEqual([100, 100]);
    expect(allocateTribeSizes([share(10), share(0)], 50, 25, 50)).toEqual([25, 25]);
    expect(allocateTribeSizes([share(100), share(1), share(1)], 120, 25, 100)).toEqual([
      70, 25, 25,
    ]);
  });

  it('hands out remainders by largest fraction, ties to the lower tribe', () => {
    expect(allocateTribeSizes([share(1), share(1), share(1)], 100, 10, 100)).toEqual([34, 33, 33]);
  });

  it('splits evenly when no tribe scored, and honours extinct / eliminated tribes', () => {
    expect(allocateTribeSizes([share(0), share(0)], 50, 10, 50)).toEqual([25, 25]);
    expect(
      allocateTribeSizes([share(5), { kind: 'min' }, { kind: 'none' }, share(5)], 200, 25, 100),
    ).toEqual([88, 25, 0, 87]);
  });
});

describe('hall of fame', () => {
  it('keeps the best K by benchmark score, ties to the earlier generation', () => {
    const hof: HallOfFameEntry[] = [];
    const entry = (generation: number, benchmarkScore: number) => ({
      genome: EMPTY_GENOME,
      benchmarkScore,
      generation,
    });
    addToHallOfFame(hof, entry(1, 10), 3);
    addToHallOfFame(hof, entry(10, 30), 3);
    addToHallOfFame(hof, entry(20, 10), 3);
    addToHallOfFame(hof, entry(30, 20), 3);
    expect(hof.map((e) => e.generation)).toEqual([10, 30, 1]);
  });

  it('benchmarks at generation 1 and every N generations', () => {
    const due = [1, 2, 9, 10, 11, 20, 50].filter((g) => isBenchmarkGeneration(g, 10));
    expect(due).toEqual([1, 10, 20, 50]);
  });
});

describe('World generations', () => {
  it('ends a generation at generationLength or when everyone is dead', () => {
    const config = smallConfig({ generationLength: 30 });
    const world = createWorld({ preset: 'small', seed: 4, config, policy: () => Action.STAY });
    for (let i = 0; i < 29; i++) world.tick();
    expect(world.isGenerationOver()).toBe(false);
    world.tick();
    expect(world.generationTick).toBe(30);
    expect(world.isGenerationOver()).toBe(true);

    const empty = createWorld({ preset: 'small', seed: 4, config, populate: false });
    expect(empty.isGenerationOver()).toBe(true);
  });

  it('startGeneration refills food, restarts ids and spawns each tribe in its zone', () => {
    const world = createWorld({ preset: 'small', seed: 4, policy: () => Action.EAT });
    for (let i = 0; i < 40; i++) world.tick();
    expect(world.map.food).not.toEqual(world.map.maxFood);

    const genomes = [genomeOf(1), genomeOf(2), genomeOf(3)];
    world.startGeneration(2, [
      { tribeId: 1, genomes: genomes.slice(0, 1) },
      { tribeId: 0, genomes },
    ]);
    expect(world.generation).toBe(2);
    expect(world.generationTick).toBe(0);
    expect(world.tickCount).toBe(40);
    expect(world.map.food).toEqual(world.map.maxFood);
    expect(world.getDepletedTileCount()).toBe(0);
    expect(world.livingCount).toBe(4);
    expect(world.creatures.map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(world.creatures.map((c) => c.tribeId)).toEqual([0, 0, 0, 1]);
    expect(world.creatures.map((c) => c.genome[0])).toEqual([1, 2, 3, 1]);
    for (const c of world.creatures) {
      const zone = world.map.spawnZones.find((z) => z.tribeId === c.tribeId)!;
      expect((c.x - zone.x) ** 2 + (c.y - zone.y) ** 2).toBeLessThanOrEqual(zone.radius ** 2);
      expect(world.occupancy[c.y * world.map.width + c.x]).toBe(c.id);
      expect(c.energy).toBe(DEFAULT_CONFIG.creature.maxEnergy);
    }
  });

  it('startGeneration rejects bad input', () => {
    const world = createWorld({ preset: 'small', seed: 4, populate: false });
    expect(() => {
      world.startGeneration(0, []);
    }).toThrow(RangeError);
    expect(() => {
      world.startGeneration(2, [
        { tribeId: 0, genomes: [] },
        { tribeId: 0, genomes: [] },
      ]);
    }).toThrow(RangeError);
    expect(() => {
      world.startGeneration(2, [{ tribeId: 9, genomes: [EMPTY_GENOME] }]);
    }).toThrow(RangeError);
  });
});

describe('EvolutionRun', () => {
  it('starts generation 1 with random genomes for every tribe', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 5 });
    const preset = DEFAULT_CONFIG.presets.small;
    expect(run.generation).toBe(1);
    expect(run.tribes.map((t) => [t.id, t.size, t.alive])).toEqual([
      [0, preset.startingCreaturesPerTribe, true],
      [1, preset.startingCreaturesPerTribe, true],
    ]);
    expect(run.world.creatures).toHaveLength(2 * preset.startingCreaturesPerTribe);
    const first = run.world.creatures[0]!.genome;
    expect(first).toHaveLength(weightCount(SPEC));
    expect(run.world.creatures[1]!.genome).not.toEqual(first);
    for (const c of run.world.creatures) {
      expect(Math.max(...c.genome)).toBeLessThan(EVO.initialWeightRange);
      expect(Math.min(...c.genome)).toBeGreaterThanOrEqual(-EVO.initialWeightRange);
    }
  });

  it('ends a generation, records stats, benchmarks gen 1 and carries the elites over', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 5,
      config: smallConfig({ generationLength: 40 }),
    });
    run.runGeneration();
    expect(run.generation).toBe(2);
    expect(run.world.tickCount).toBe(40);
    expect(run.world.generationTick).toBe(0);
    for (const tribe of run.tribes) {
      expect(tribe.history).toHaveLength(1);
      const stats = tribe.history[0]!;
      expect(stats.generation).toBe(1);
      expect(stats.population).toBe(25);
      expect(stats.survivors + stats.deaths).toBe(25);
      expect(stats.maxFitness).toBeGreaterThanOrEqual(stats.avgFitness);
      expect(stats.benchmarkScore).not.toBeNull();
      expect(tribe.hallOfFame).toHaveLength(1);
      expect(tribe.hallOfFame[0]!.benchmarkScore).toBe(stats.benchmarkScore);
      // Elite #1 (the benchmarked champion) leads the tribe's next generation unchanged.
      expect(tribeGenomes(run, tribe.id)[0]).toEqual(tribe.hallOfFame[0]!.genome);
    }
    run.runGeneration();
    expect(run.tribes[0]!.history[1]!.benchmarkScore).toBeNull();
  });

  it('draws from rng.evolution only at generation end, never from the policy stream', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 5,
      config: smallConfig({ generationLength: 20 }),
    });
    const evolutionState = run.world.rng.evolution.getState();
    const policyState = run.world.rng.policy.getState();
    for (let i = 0; i < 19; i++) run.tick();
    expect(run.world.rng.evolution.getState()).toEqual(evolutionState);
    run.tick();
    expect(run.generation).toBe(2);
    expect(run.world.rng.evolution.getState()).not.toEqual(evolutionState);
    expect(run.world.rng.policy.getState()).toEqual(policyState);
  });

  it('is deterministic: same seed → same hash, other seed → different hash', () => {
    const config = smallConfig({ generationLength: 30 });
    const hashAfter = (seed: number) => {
      const run = createEvolutionRun({ preset: 'small', seed, config });
      for (let g = 0; g < 3; g++) run.runGeneration();
      return run.hash();
    };
    expect(hashAfter(8)).toBe(hashAfter(8));
    expect(hashAfter(8)).not.toBe(hashAfter(9));
  });

  it('re-allocates tribe sizes by tribe score within [minTribeSize, popCap]', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig({ generationLength: 30, minTribeSize: 10, popCapPerTribe: 40 }),
    });
    run.runGeneration();
    const [a, b] = run.tribes;
    expect(a!.size + b!.size).toBe(50);
    for (const t of run.tribes) {
      expect(t.size).toBeGreaterThanOrEqual(10);
      expect(t.size).toBeLessThanOrEqual(40);
      expect(tribeGenomes(run, t.id)).toHaveLength(t.size);
    }
    const scoreA = a!.history[0]!.tribeScore;
    const scoreB = b!.history[0]!.tribeScore;
    const fairShareA = Math.min(40, Math.max(10, (50 * scoreA) / (scoreA + scoreB)));
    expect(Math.abs(a!.size - fairShareA)).toBeLessThanOrEqual(1);
  });

  it('respawns an extinct tribe at minTribeSize, led by its hall of fame', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig({ generationLength: 30, minTribeSize: 10, popCapPerTribe: 40 }),
    });
    for (let i = 0; i < 10; i++) run.tick();
    doomTribe(run, 1);
    run.runGeneration();
    const tribe1 = run.tribes[1]!;
    expect(tribe1.history[0]!.survivors).toBe(0);
    expect(tribe1.alive).toBe(true);
    expect(tribe1.size).toBe(10);
    expect(run.tribes[0]!.size).toBe(40);
    expect(tribeGenomes(run, 1)[0]).toEqual(tribe1.hallOfFame[0]!.genome);
  });

  it('keeps the total population when every tribe went extinct', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig({ generationLength: 30, minTribeSize: 10, popCapPerTribe: 40 }),
    });
    for (let i = 0; i < 10; i++) run.tick();
    doomTribe(run, 0);
    doomTribe(run, 1);
    run.tick();
    expect(run.generation).toBe(2);
    expect(run.tribes.map((t) => t.history[0]!.survivors)).toEqual([0, 0]);
    expect(run.tribes[0]!.size + run.tribes[1]!.size).toBe(50);
    expect(run.world.livingCount).toBe(50);
    // Both still breed from their hall of fame first (extinction rule).
    for (const t of run.tribes) {
      expect(tribeGenomes(run, t.id)[0]).toEqual(t.hallOfFame[0]!.genome);
    }
  });

  it('battle royale: eliminates extinct tribes and ends the run with one tribe left', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig({ generationLength: 30 }, { extinction: 'battle-royale' }),
    });
    for (let i = 0; i < 10; i++) run.tick();
    doomTribe(run, 1);
    run.tick(); // tribe 1 dies → only tribe 0 left → generation over → run over
    expect(run.finished).toBe(true);
    expect(run.winner).toBe(0);
    expect(run.tribes.map((t) => t.alive)).toEqual([true, false]);
    const ticks = run.world.tickCount;
    run.tick();
    expect(run.world.tickCount).toBe(ticks);
  });

  it('battle royale continues normally while several tribes survive', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig({ generationLength: 30 }, { extinction: 'battle-royale' }),
    });
    run.runGeneration();
    expect(run.finished).toBe(false);
    expect(run.generation).toBe(2);
    expect(run.tribes.every((t) => t.alive)).toBe(true);
  });
});

describe('benchmark arena', () => {
  /** EAT when hydration > energy, else DRINK (DRINK away from water resolves as STAY). */
  function foragerGenome(): Float32Array {
    const g = createZeroGenome(SPEC);
    g[inputWeightIndex(SPEC, 0, SensorIndex.HYDRATION)] = 4;
    g[inputWeightIndex(SPEC, 0, SensorIndex.ENERGY)] = -4;
    g[outputWeightIndex(SPEC, 0, Action.EAT)] = 2;
    g[outputWeightIndex(SPEC, 0, Action.DRINK)] = -2;
    g[outputBiasIndex(SPEC, Action.EAT)] = 0.1;
    g[outputBiasIndex(SPEC, Action.DRINK)] = 0.1;
    return g;
  }

  function stayGenome(): Float32Array {
    const g = createZeroGenome(SPEC);
    g[outputBiasIndex(SPEC, Action.STAY)] = 1;
    return g;
  }

  const arena = createBenchmarkArena('small', DEFAULT_CONFIG);

  it('is deterministic and scores a forager above a creature that only stays', () => {
    const forager = runBenchmark(arena, foragerGenome());
    expect(runBenchmark(arena, foragerGenome())).toBe(forager);
    const stayer = runBenchmark(arena, stayGenome());
    expect(stayer).toBeGreaterThan(0);
    expect(forager).toBeGreaterThan(stayer);
  });

  it('rejects genomes of the wrong size', () => {
    expect(() => runBenchmark(arena, new Float32Array(10))).toThrow(RangeError);
  });
});
