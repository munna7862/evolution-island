import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
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
  createRngStreams,
  createWorld,
  createZeroGenome,
  DEFAULT_CONFIG,
  EMPTY_GENOME,
  findInHallOfFame,
  inputWeightIndex,
  isBenchmarkGeneration,
  outputBiasIndex,
  outputWeightIndex,
  pickParent,
  rankByFitness,
  respawnGenomes,
  runBenchmark,
  runBenchmarkDetailed,
  sameGenome,
  SensorIndex,
  weightCount,
  type EvolutionConfig,
  type EvolutionStart,
  type EvolutionRun,
  type HallOfFameEntry,
  type MapPreset,
  type SimConfig,
} from '../src/index.js';

const EVO = DEFAULT_CONFIG.evolution;
/** Truncation selection (the default is tournament since Sprint 3.4). */
const TRUNCATION: EvolutionConfig = { ...EVO, selection: 'truncation', parentFraction: 0.2 };
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
    for (let i = 0; i < 500; i++) picked.add(pickParent(candidates, TRUNCATION, rng)[0]!);
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
    const evo: EvolutionConfig = { ...TRUNCATION, crossover: false, eliteCount: 0 };
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

  // Sprint 3.2 review: fixing low tribes at min first and the leader at popCap afterwards never
  // gave the low tribes back what the cap freed, so these lost 25 of Medium's 200 creatures.
  it('keeps the whole budget when one tribe hits popCap and the rest scored little', () => {
    expect(
      allocateTribeSizes([share(750), share(125), share(125), share(125)], 200, 25, 100),
    ).toEqual([100, 34, 33, 33]);
    expect(allocateTribeSizes([share(1000), share(10), share(10), share(1)], 200, 25, 100)).toEqual(
      [100, 38, 37, 25],
    );
  });

  it('stays at the clamps when the budget cannot be met', () => {
    expect(allocateTribeSizes([share(1), share(1)], 300, 25, 100)).toEqual([100, 100]);
    expect(allocateTribeSizes([share(9), share(1), share(0)], 60, 25, 100)).toEqual([25, 25, 25]);
  });

  it('gives places a capped leader cannot take to the extinct tribes (Sprint 4.2)', () => {
    const min = { kind: 'min' as const };
    // Medium, one tribe alone survived: 100 + 3 × 25 = 175 before; now the total stays 200.
    expect(allocateTribeSizes([share(900), min, min, min], 200, 25, 100)).toEqual([
      100, 34, 33, 33,
    ]);
    expect(allocateTribeSizes([min, share(50), min], 200, 25, 100)).toEqual([50, 100, 50]);
    // Extinct tribes never pass the cap either.
    expect(allocateTribeSizes([share(1), min], 400, 25, 100)).toEqual([100, 100]);
    // While the scoring tribes can still grow, extinct tribes stay at the minimum.
    expect(allocateTribeSizes([share(3), share(1), min], 200, 25, 100)).toEqual([100, 75, 25]);
  });

  it('property: sizes within [min, max], total = budget when feasible, order follows score', () => {
    const tribe = fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: 0, max: 5000 }).map((s) => share(s)) },
      { weight: 1, arbitrary: fc.constant({ kind: 'min' as const }) },
      { weight: 1, arbitrary: fc.constant({ kind: 'none' as const }) },
    );
    fc.assert(
      fc.property(
        fc.array(tribe, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 1500 }),
        (tribes, min, extra, budget) => {
          const max = min + extra;
          const sizes = allocateTribeSizes(tribes, budget, min, max);
          const shares = tribes.flatMap((t, i) => (t.kind === 'share' ? [i] : []));
          let floor = 0;
          let ceiling = 0;
          tribes.forEach((t, i) => {
            if (t.kind === 'none') expect(sizes[i]).toBe(0);
            if (t.kind === 'min' || t.kind === 'share') {
              expect(sizes[i]).toBeGreaterThanOrEqual(min);
              expect(sizes[i]).toBeLessThanOrEqual(max);
            }
            floor += t.kind === 'none' ? 0 : min;
            ceiling += t.kind === 'min' ? max : t.kind === 'share' && t.score > 0 ? max : 0;
          });
          const anyScore = shares.some((i) => (tribes[i] as { score: number }).score > 0);
          if (!anyScore) ceiling += shares.length * (max - min);
          const total = sizes.reduce((a, s) => a + s, 0);
          // An extinct tribe only gets more than `min` once every tribe that could take places is
          // at `max`.
          if (tribes.some((t, i) => t.kind === 'min' && sizes[i]! > min)) {
            for (const i of shares) {
              if (!anyScore || (tribes[i] as { score: number }).score > 0) {
                expect(sizes[i]).toBe(max);
              }
            }
          }
          if (shares.length > 0 && budget >= floor && budget <= ceiling) {
            expect(total).toBe(budget);
          }
          for (const i of shares) {
            for (const j of shares) {
              const si = (tribes[i] as { score: number }).score;
              const sj = (tribes[j] as { score: number }).score;
              if (si > sj) expect(sizes[i]! + 1).toBeGreaterThanOrEqual(sizes[j]!);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('respawnGenomes (extinct tribe, respawn mode)', () => {
  const rng = () => createRngStream('respawn');
  const hof = (...values: number[]): HallOfFameEntry[] =>
    values.map((v, i) => ({ genome: genomeOf(v), benchmarkScore: 100 - i, generation: i + 1 }));

  it('brings back the best hall-of-fame genome unchanged and breeds the rest from members', () => {
    const members = [genomeOf(0.5), genomeOf(-0.5), genomeOf(0.25)];
    const next = respawnGenomes(SPEC, hof(3, 2), members, 10, EVO, rng());
    expect(next).toHaveLength(10);
    expect(next[0]).toEqual(genomeOf(3));
    // Same draws as breeding the members alone: the hall of fame takes no parent slot.
    expect(next.slice(1)).toEqual(breedGenomes(SPEC, members, 9, EVO, rng()));
    for (const g of next.slice(1)) {
      expect(g.some((w) => w === 3 || w === 2)).toBe(false);
    }
  });

  it('falls back to the members without a hall of fame, and to the hall of fame without members', () => {
    const members = [genomeOf(0.5), genomeOf(-0.5)];
    expect(respawnGenomes(SPEC, [], members, 6, EVO, rng())).toEqual(
      breedGenomes(SPEC, members, 6, EVO, rng()),
    );
    expect(respawnGenomes(SPEC, hof(3, 2), [], 6, EVO, rng())).toEqual(
      breedGenomes(SPEC, [genomeOf(3), genomeOf(2)], 6, EVO, rng()),
    );
    expect(respawnGenomes(SPEC, hof(3), members, 0, EVO, rng())).toEqual([]);
  });
});

describe('hall of fame', () => {
  it('keeps the best K by benchmark score, ties to the earlier generation', () => {
    const hof: HallOfFameEntry[] = [];
    const entry = (generation: number, benchmarkScore: number) => ({
      genome: genomeOf(generation / 100),
      benchmarkScore,
      generation,
    });
    addToHallOfFame(hof, entry(1, 10), 3);
    addToHallOfFame(hof, entry(10, 30), 3);
    addToHallOfFame(hof, entry(20, 10), 3);
    addToHallOfFame(hof, entry(30, 20), 3);
    expect(hof.map((e) => e.generation)).toEqual([10, 30, 1]);
  });

  it('holds distinct genomes: a champion already in it is not added again', () => {
    const hof: HallOfFameEntry[] = [];
    addToHallOfFame(hof, { genome: genomeOf(0.5), benchmarkScore: 557, generation: 10 }, 3);
    addToHallOfFame(hof, { genome: genomeOf(0.1), benchmarkScore: 550, generation: 30 }, 3);
    addToHallOfFame(hof, { genome: genomeOf(0.5), benchmarkScore: 557, generation: 40 }, 3);
    addToHallOfFame(hof, { genome: genomeOf(0.2), benchmarkScore: 540, generation: 50 }, 3);
    expect(hof.map((e) => [e.generation, e.benchmarkScore])).toEqual([
      [10, 557],
      [30, 550],
      [50, 540],
    ]);
    expect(findInHallOfFame(hof, genomeOf(0.1))?.generation).toBe(30);
    expect(findInHallOfFame(hof, genomeOf(0.3))).toBeUndefined();
  });

  it('compares genomes weight by weight', () => {
    const a = genomeOf(0.5);
    const b = Float32Array.from(a);
    expect(sameGenome(a, b)).toBe(true);
    b[b.length - 1] = 0.25;
    expect(sameGenome(a, b)).toBe(false);
    expect(sameGenome(a, a.subarray(1))).toBe(false);
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

  describe('start from given genomes (Sprint 3.3: playing a saved checkpoint)', () => {
    const hofEntry = (value: number, benchmarkScore: number, generation: number) => ({
      genome: genomeOf(value),
      benchmarkScore,
      generation,
    });
    const start = (): EvolutionStart => ({
      generation: 30,
      tribes: [
        {
          tribeId: 1,
          alive: true,
          genomes: [genomeOf(0.3), genomeOf(-0.3), genomeOf(0.3)],
          hallOfFame: [hofEntry(0.3, 700, 20), hofEntry(-0.3, 650, 10)],
        },
        {
          tribeId: 0,
          alive: true,
          genomes: Array.from({ length: 27 }, (_, i) => genomeOf(i / 100)),
          hallOfFame: [hofEntry(0.5, 500, 30), hofEntry(0.7, 900, 10)],
        },
      ],
    });

    it('spawns the given genomes in order with the given sizes and hall of fame, drawing nothing', () => {
      const run = createEvolutionRun({ preset: 'small', seed: 5, start: start() });
      expect(run.generation).toBe(30);
      expect(run.tribes.map((t) => [t.id, t.size, t.alive])).toEqual([
        [0, 27, true],
        [1, 3, true],
      ]);
      expect(tribeGenomes(run, 0)).toEqual(start().tribes[1]!.genomes);
      expect(tribeGenomes(run, 1)).toEqual(start().tribes[0]!.genomes);
      // Hall of fame re-sorted best first and copied (not the caller's arrays).
      const hof0 = run.tribes[0]!.hallOfFame;
      expect(hof0.map((e) => [e.benchmarkScore, e.generation])).toEqual([
        [900, 10],
        [500, 30],
      ]);
      const fresh = createRngStreams(5).evolution.getState();
      expect(run.world.rng.evolution.getState()).toEqual(fresh);
    });

    it('evolves on from the given genomes', () => {
      const run = createEvolutionRun({
        preset: 'small',
        seed: 5,
        config: smallConfig({ generationLength: 20 }),
        start: start(),
      });
      run.runGeneration();
      expect(run.generation).toBe(31);
      expect(run.tribes[0]!.history[0]!.generation).toBe(30);
      expect(run.tribes[0]!.history[0]!.population).toBe(27);
      // 30 is a benchmark generation; the given hall of fame is kept and extended.
      expect(run.tribes[0]!.hallOfFame.length).toBeGreaterThanOrEqual(2);
      expect(run.world.creatures.length).toBe(run.tribes[0]!.size + run.tribes[1]!.size);
    });

    it('does not benchmark a champion again that is already in the hall of fame', () => {
      // Tribe 1 plays only its hall-of-fame genomes (like a played checkpoint), so its champion
      // is one of them; tribe 0 plays new genomes, so its champion is benchmarked as usual.
      const run = createEvolutionRun({
        preset: 'small',
        seed: 5,
        config: smallConfig({ generationLength: 20 }),
        start: start(),
      });
      const benchmark = vi.spyOn(run, 'benchmark');
      run.runGeneration();
      expect(benchmark).toHaveBeenCalledTimes(1);
      const tribe1 = run.tribes[1]!;
      expect(tribe1.hallOfFame.map((e) => [e.benchmarkScore, e.generation])).toEqual([
        [700, 20],
        [650, 10],
      ]);
      expect([700, 650]).toContain(tribe1.history[0]!.benchmarkScore);
      expect(run.tribes[0]!.hallOfFame.length).toBe(3);
    });

    it('keeps at most hallOfFameSize distinct entries of a given hall of fame', () => {
      const s = start();
      const many = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v, i) => hofEntry(v, 100 + i, i + 1));
      many.push(hofEntry(0.6, 105, 9)); // the same champion saved twice (a pre-review file)
      const run = createEvolutionRun({
        preset: 'small',
        seed: 5,
        start: { ...s, tribes: [s.tribes[0]!, { ...s.tribes[1]!, hallOfFame: many }] },
      });
      expect(run.tribes[0]!.hallOfFame.map((e) => [e.benchmarkScore, e.generation])).toEqual([
        [105, 6],
        [104, 5],
        [103, 4],
        [102, 3],
        [101, 2],
      ]);
      expect(DEFAULT_CONFIG.evolution.hallOfFameSize).toBe(5);
    });

    it('is deterministic, so a checkpoint plays the same in Node and the browser', () => {
      const hashAfter = () => {
        const run = createEvolutionRun({ preset: 'small', seed: 5, start: start() });
        for (let i = 0; i < 50; i++) run.tick();
        return run.hash();
      };
      expect(hashAfter()).toBe(hashAfter());
    });

    it('takes an eliminated tribe without creatures', () => {
      const s = start();
      const run = createEvolutionRun({
        preset: 'small',
        seed: 5,
        start: { ...s, tribes: [s.tribes[0]!, { ...s.tribes[1]!, alive: false, genomes: [] }] },
      });
      expect(run.tribes[0]!.alive).toBe(false);
      expect(run.tribes[0]!.size).toBe(0);
      expect(tribeGenomes(run, 0)).toEqual([]);
    });

    it('refuses starts that do not fit the map or the brain', () => {
      const s = start();
      const make = (tribes: EvolutionStart['tribes']) => () =>
        createEvolutionRun({ preset: 'small', seed: 5, start: { generation: 2, tribes } });
      expect(make([s.tribes[0]!])).toThrow(/missing tribe 0/);
      expect(make([...s.tribes, { ...s.tribes[0]!, tribeId: 7 }])).toThrow(/tribe 7/);
      expect(make([...s.tribes, s.tribes[0]!])).toThrow(/twice/);
      expect(make([s.tribes[0]!, { ...s.tribes[1]!, genomes: [new Float32Array(3)] }])).toThrow();
      expect(make([s.tribes[0]!, { ...s.tribes[1]!, alive: false }])).toThrow(/Eliminated/);
    });
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

  it('respawns an extinct tribe at minTribeSize: hall-of-fame champion + members offspring', () => {
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
    const genomes = tribeGenomes(run, 1);
    expect(genomes[0]).toEqual(tribe1.hallOfFame[0]!.genome);
    // Only the champion returns as is; generation 1's champion IS the best member, so it also
    // comes back once as an elite of the members' breeding, and no further unchanged copies.
    const champion = tribe1.hallOfFame[0]!.genome;
    const copies = genomes.filter((g) => g.every((w, i) => w === champion[i])).length;
    expect(copies).toBe(2);
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
    // Both are still respawned: their hall-of-fame champion comes back first (extinction rule).
    for (const t of run.tribes) {
      expect(tribeGenomes(run, t.id)[0]).toEqual(t.hallOfFame[0]!.genome);
    }
  });

  it('battle royale: eliminates extinct tribes and ends the run with one tribe left', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig(
        { generationLength: 30 },
        { extinction: 'battle-royale', battleRoyaleFromGeneration: 1 },
      ),
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
      config: smallConfig(
        { generationLength: 30 },
        { extinction: 'battle-royale', battleRoyaleFromGeneration: 1 },
      ),
    });
    run.runGeneration();
    expect(run.finished).toBe(false);
    expect(run.generation).toBe(2);
    expect(run.tribes.every((t) => t.alive)).toBe(true);
  });

  it('battle royale eliminates nobody before battleRoyaleFromGeneration (Sprint 4.2)', () => {
    const run = createEvolutionRun({
      preset: 'small',
      seed: 6,
      config: smallConfig(
        { generationLength: 30 },
        { extinction: 'battle-royale', battleRoyaleFromGeneration: 3 },
      ),
    });
    for (const generation of [1, 2]) {
      for (let i = 0; i < 10; i++) run.tick();
      doomTribe(run, 1);
      run.runGeneration(); // tribe 1 dies out: respawned, and the generation ran its full length
      expect(run.generation).toBe(generation + 1);
      expect(run.finished).toBe(false);
      expect(run.tribes.map((t) => t.alive)).toEqual([true, true]);
      expect(run.tribes[1]!.history.at(-1)!.survivors).toBe(0);
      expect(run.world.tickCount).toBe(30 * generation);
    }
    for (let i = 0; i < 10; i++) run.tick();
    doomTribe(run, 1);
    run.tick(); // generation 3: tribe 1 dies → eliminated, the run is over
    expect(run.finished).toBe(true);
    expect(run.winner).toBe(0);
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

  it("reports the clones' resolved actions: one per living clone per tick (Sprint 4.2)", () => {
    const stay = runBenchmarkDetailed(arena, stayGenome());
    expect(stay.score).toBe(runBenchmark(arena, stayGenome()));
    const clones = DEFAULT_CONFIG.presets.small.startingCreaturesPerTribe;
    // A STAY-only clone lives ticksAlive ticks and acts once more on the tick it dies.
    const ticksAlive = stay.score; // fitness = ticksAlive (no intake) for every clone
    expect(stay.actions[Action.STAY]).toBe(clones * (ticksAlive + 1));
    expect(stay.actions.reduce((a, n) => a + n, 0)).toBe(stay.actions[Action.STAY]);

    const forager = runBenchmarkDetailed(arena, foragerGenome());
    expect(forager.score).toBe(runBenchmark(arena, foragerGenome()));
    expect(forager.actions).toHaveLength(9);
    expect(forager.actions[Action.EAT]).toBeGreaterThan(0);
    expect(forager.actions[Action.ATTACK]).toBe(0); // nobody to attack in a one-tribe arena
  });
});
