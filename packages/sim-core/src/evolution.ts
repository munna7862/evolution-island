import { createBenchmarkArena, runBenchmark, type BenchmarkArena } from './benchmark.js';
import { brainSpecFromConfig, createBrainPolicy, type BrainSpec } from './brain.js';
import {
  DEFAULT_CONFIG,
  type EvolutionConfig,
  type MapPresetId,
  type SimConfig,
} from './config.js';
import type { Creature } from './creature.js';
import { creatureFitness, tribeOutcome, tribeScore } from './fitness.js';
import { crossoverPerNeuron, mutateGenome, randomGenome } from './genome.js';
import { StateHasher } from './hash.js';
import type { RngStream, Seed } from './rng.js';
import { createWorld, type TribeSpawn, type World } from './world.js';

/**
 * Generations & genetic algorithm (plan §2.5): ranking, selection, elitism, breeding per tribe,
 * tribe-size re-allocation, extinction, hall of fame, and the `EvolutionRun` driver. All
 * randomness comes from the run world's `rng.evolution` stream, tribes in ascending id order.
 */

export interface RankedCreature {
  readonly id: number;
  readonly fitness: number;
  readonly genome: Float32Array;
}

/** Best first; equal fitness → lower id first (plan §2.5). Dead creatures keep their fitness. */
export function rankByFitness(
  members: readonly Creature[],
  evolution: EvolutionConfig,
): RankedCreature[] {
  const ranked = members.map((c) => ({
    id: c.id,
    fitness: creatureFitness(c.stats, evolution),
    genome: c.genome,
  }));
  ranked.sort((a, b) => {
    if (a.fitness !== b.fitness) return b.fitness - a.fitness;
    return a.id - b.id;
  });
  return ranked;
}

/** Truncation: uniform over the top `parentFraction`; tournament: best of `tournamentSize` draws. */
export function pickParent(
  candidates: readonly Float32Array[],
  evolution: EvolutionConfig,
  rng: RngStream,
): Float32Array {
  const n = candidates.length;
  if (n === 0) {
    throw new RangeError('pickParent needs at least one candidate');
  }
  if (evolution.selection === 'tournament') {
    let best = n - 1;
    const rounds = Math.max(1, Math.floor(evolution.tournamentSize));
    for (let t = 0; t < rounds; t++) {
      best = Math.min(best, rng.nextInt(0, n));
    }
    return candidates[best]!;
  }
  const parents = Math.max(1, Math.min(n, Math.ceil(evolution.parentFraction * n)));
  return candidates[rng.nextInt(0, parents)]!;
}

/**
 * `count` genomes for the next generation from `candidates` (best first): the best `eliteCount`
 * copied unchanged, the rest bred from two parents (per-neuron crossover, or a copy of the first
 * parent when crossover is off) and mutated. No candidates → fresh random genomes.
 */
export function breedGenomes(
  spec: BrainSpec,
  candidates: readonly Float32Array[],
  count: number,
  evolution: EvolutionConfig,
  rng: RngStream,
): Float32Array[] {
  const next: Float32Array[] = [];
  if (candidates.length === 0) {
    for (let i = 0; i < count; i++) {
      next.push(randomGenome(spec, rng, evolution.initialWeightRange));
    }
    return next;
  }
  const elites = Math.max(0, Math.min(Math.floor(evolution.eliteCount), count, candidates.length));
  for (let i = 0; i < elites; i++) {
    next.push(Float32Array.from(candidates[i]!));
  }
  const mutation = {
    rate: evolution.mutationRate,
    sigma: evolution.mutationSigma,
    clamp: evolution.weightClamp,
  };
  while (next.length < count) {
    const a = pickParent(candidates, evolution, rng);
    const child = evolution.crossover
      ? crossoverPerNeuron(spec, a, pickParent(candidates, evolution, rng), rng)
      : Float32Array.from(a);
    mutateGenome(child, rng, mutation);
    next.push(child);
  }
  return next;
}

export type TribeAllocation =
  /** Shares the budget in proportion to its score. */
  | { readonly kind: 'share'; readonly score: number }
  /** Extinct in respawn mode: returns at `minTribeSize`. */
  | { readonly kind: 'min' }
  /** Eliminated (battle royale): 0. */
  | { readonly kind: 'none' };

/**
 * Splits `budget` creatures between tribes in proportion to their scores (plan §2.5), each share
 * clamped to [min, max]: tribes below min are fixed at min, then tribes above max at max, and the
 * rest re-split until stable; integer sizes by largest remainder (ties → lower index). The total
 * equals the budget whenever the clamps allow it. Non-positive scores count as 0; if every score
 * is 0 the budget is split evenly.
 */
export function allocateTribeSizes(
  tribes: readonly TribeAllocation[],
  budget: number,
  min: number,
  max: number,
): number[] {
  const sizes = tribes.map((t) => (t.kind === 'min' ? min : 0));
  let free: number[] = [];
  tribes.forEach((t, i) => {
    if (t.kind === 'share') free.push(i);
  });
  const scoreOf = (i: number): number => {
    const t = tribes[i]!;
    return t.kind === 'share' && t.score > 0 ? t.score : 0;
  };
  let freeBudget = budget - sizes.reduce((acc, s) => acc + s, 0);
  let shares = new Map<number, number>();

  while (free.length > 0) {
    const total = free.reduce((acc, i) => acc + scoreOf(i), 0);
    shares = new Map(
      free.map((i) => [
        i,
        total > 0 ? (freeBudget * scoreOf(i)) / total : freeBudget / free.length,
      ]),
    );
    let fixed = free.filter((i) => shares.get(i)! < min);
    let bound = min;
    if (fixed.length === 0) {
      fixed = free.filter((i) => shares.get(i)! > max);
      bound = max;
    }
    if (fixed.length === 0) break;
    for (const i of fixed) {
      sizes[i] = bound;
      freeBudget -= bound;
    }
    free = free.filter((i) => !fixed.includes(i));
  }

  if (free.length > 0) {
    let assigned = 0;
    for (const i of free) {
      sizes[i] = Math.floor(shares.get(i)!);
      assigned += sizes[i];
    }
    const byRemainder = [...free].sort((a, b) => {
      const ra = shares.get(a)! - sizes[a]!;
      const rb = shares.get(b)! - sizes[b]!;
      if (ra !== rb) return rb - ra;
      return a - b;
    });
    let left = Math.max(0, Math.round(freeBudget - assigned));
    for (const i of byRemainder) {
      if (left === 0) break;
      sizes[i] = sizes[i]! + 1;
      left--;
    }
  }
  return sizes;
}

export interface HallOfFameEntry {
  readonly genome: Float32Array;
  readonly benchmarkScore: number;
  readonly generation: number;
}

/** Inserts `entry` and keeps the best `size` by benchmark score (ties → earlier generation). */
export function addToHallOfFame(
  hallOfFame: HallOfFameEntry[],
  entry: HallOfFameEntry,
  size: number,
): void {
  hallOfFame.push(entry);
  hallOfFame.sort((a, b) => {
    if (a.benchmarkScore !== b.benchmarkScore) return b.benchmarkScore - a.benchmarkScore;
    return a.generation - b.generation;
  });
  hallOfFame.length = Math.min(hallOfFame.length, Math.max(0, Math.floor(size)));
}

/** Per tribe, per generation (plan §3.5 `GenerationStats`). */
export interface GenerationStats {
  readonly generation: number;
  readonly population: number;
  readonly survivors: number;
  readonly deaths: number;
  readonly avgFitness: number;
  readonly maxFitness: number;
  readonly foodGathered: number;
  readonly territoryPct: number;
  readonly kills: number;
  readonly tribeScore: number;
  /** Champion's benchmark-arena score, or null when not benchmarked this generation. */
  readonly benchmarkScore: number | null;
}

export interface TribeState {
  readonly id: number;
  /** Creatures allocated for the current generation. */
  size: number;
  /** False only once eliminated in battle royale. */
  alive: boolean;
  readonly hallOfFame: HallOfFameEntry[];
  readonly history: GenerationStats[];
}

export interface EvolutionRunOptions {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly config?: SimConfig;
}

/** Benchmark at generation 1 and every `interval` generations. */
export function isBenchmarkGeneration(generation: number, interval: number): boolean {
  return generation === 1 || (interval > 0 && generation % interval === 0);
}

/**
 * Drives a brain-controlled world through generations: `tick()` advances the world and, when the
 * generation is over, ranks every tribe, records stats, benchmarks champions when due, updates
 * the hall of fame, re-allocates tribe sizes, breeds each tribe's next genomes and restarts the
 * world (plan §2.5, §3.4).
 */
export class EvolutionRun {
  readonly world: World;
  readonly config: SimConfig;
  readonly spec: BrainSpec;
  readonly tribes: TribeState[];
  /** Battle royale only: the run ends when at most one tribe is left. */
  finished = false;
  winner: number | null = null;

  private arena: BenchmarkArena | null = null;

  constructor(options: EvolutionRunOptions) {
    this.config = options.config ?? DEFAULT_CONFIG;
    this.spec = brainSpecFromConfig(this.config);
    this.world = createWorld({
      preset: options.preset,
      seed: options.seed,
      config: this.config,
      populate: false,
      policy: createBrainPolicy(this.spec, (c) => c.genome),
    });
    const startSize = this.config.presets[options.preset].startingCreaturesPerTribe;
    const tribeIds = this.world.map.spawnZones.map((z) => z.tribeId).sort((a, b) => a - b);
    this.tribes = tribeIds.map((id) => ({
      id,
      size: startSize,
      alive: true,
      hallOfFame: [],
      history: [],
    }));
    const rng = this.world.rng.evolution;
    const range = this.config.evolution.initialWeightRange;
    this.world.startGeneration(
      1,
      this.tribes.map((t) => ({
        tribeId: t.id,
        genomes: Array.from({ length: t.size }, () => randomGenome(this.spec, rng, range)),
      })),
    );
  }

  get generation(): number {
    return this.world.generation;
  }

  /** One world tick, then generation end if the generation is over. No-op once finished. */
  tick(): void {
    if (this.finished) return;
    this.world.tick();
    if (this.isGenerationOver()) {
      this.endGeneration();
    }
  }

  /** Ticks until the current generation has ended (or the run finished). */
  runGeneration(): void {
    const generation = this.world.generation;
    while (!this.finished && this.world.generation === generation) {
      this.tick();
    }
  }

  /** Benchmark-arena score of any genome on this run's preset and config. */
  benchmark(genome: Float32Array): number {
    this.arena ??= createBenchmarkArena(this.world.preset, this.config);
    return runBenchmark(this.arena, genome);
  }

  hash(): string {
    const hasher = new StateHasher();
    hasher
      .writeString(this.world.hash())
      .writeBoolean(this.finished)
      .writeInt32(this.winner ?? -1)
      .writeUint32(this.tribes.length);
    for (const t of this.tribes) {
      hasher
        .writeUint32(t.id)
        .writeUint32(t.size)
        .writeBoolean(t.alive)
        .writeUint32(t.history.length)
        .writeUint32(t.hallOfFame.length);
      for (const entry of t.hallOfFame) {
        hasher
          .writeUint32(entry.generation)
          .writeFloat64(entry.benchmarkScore)
          .writeFloat32Array(entry.genome);
      }
      const last = t.history[t.history.length - 1];
      if (last !== undefined) {
        hasher
          .writeFloat64(last.avgFitness)
          .writeFloat64(last.maxFitness)
          .writeFloat64(last.tribeScore)
          .writeFloat64(last.benchmarkScore ?? -1);
      }
    }
    return hasher.digest();
  }

  private isGenerationOver(): boolean {
    if (this.world.isGenerationOver()) return true;
    if (this.config.evolution.extinction !== 'battle-royale') return false;
    const living = new Set<number>();
    for (const c of this.world.creatures) {
      if (c.alive) living.add(c.tribeId);
    }
    return living.size <= 1;
  }

  private endGeneration(): void {
    const evo = this.config.evolution;
    const generation = this.world.generation;
    const benchmarkDue = isBenchmarkGeneration(generation, evo.benchmarkInterval);
    const aliveTribes = this.tribes.filter((t) => t.alive);

    const results = aliveTribes.map((tribe) => {
      const members = this.world.creatures.filter((c) => c.tribeId === tribe.id);
      const ranked = rankByFitness(members, evo);
      const outcome = tribeOutcome(members);
      const score = tribeScore(outcome, evo);
      let benchmarkScore: number | null = null;
      if (benchmarkDue && ranked.length > 0) {
        const champion = ranked[0]!.genome;
        benchmarkScore = this.benchmark(champion);
        addToHallOfFame(
          tribe.hallOfFame,
          { genome: Float32Array.from(champion), benchmarkScore, generation },
          evo.hallOfFameSize,
        );
      }
      let fitnessSum = 0;
      let kills = 0;
      for (const r of ranked) fitnessSum += r.fitness;
      for (const c of members) kills += c.stats.kills;
      tribe.history.push({
        generation,
        population: members.length,
        survivors: outcome.survivors,
        deaths: members.length - outcome.survivors,
        avgFitness: ranked.length > 0 ? fitnessSum / ranked.length : 0,
        maxFitness: ranked.length > 0 ? ranked[0]!.fitness : 0,
        foodGathered: outcome.foodGathered,
        territoryPct: outcome.territoryPct,
        kills,
        tribeScore: score,
        benchmarkScore,
      });
      return { tribe, ranked, score, extinct: outcome.survivors === 0 };
    });

    if (evo.extinction === 'battle-royale') {
      for (const r of results) {
        if (r.extinct) r.tribe.alive = false;
      }
      const remaining = this.tribes.filter((t) => t.alive);
      if (remaining.length <= 1) {
        this.finished = true;
        this.winner = remaining.length === 1 ? remaining[0]!.id : null;
        return;
      }
    }

    const preset = this.config.presets[this.world.preset];
    // Extinct tribes drop to minTribeSize only when another tribe survived. If every tribe died,
    // nobody won the freed places, and fixing all at the minimum would shrink the population
    // (the plan keeps the total roughly constant), so the budget is split by score as usual.
    const anySurvivors = results.some((r) => !r.extinct);
    const allocations: TribeAllocation[] = this.tribes.map((t) => {
      const r = results.find((x) => x.tribe === t);
      if (r === undefined || !t.alive) return { kind: 'none' };
      if (r.extinct && anySurvivors) return { kind: 'min' };
      return { kind: 'share', score: r.score };
    });
    const sizes = allocateTribeSizes(
      allocations,
      preset.tribeCount * preset.startingCreaturesPerTribe,
      preset.minTribeSize,
      preset.popCapPerTribe,
    );

    const rng = this.world.rng.evolution;
    const spawns: TribeSpawn[] = [];
    for (const r of results) {
      if (!r.tribe.alive) continue;
      const size = sizes[this.tribes.indexOf(r.tribe)]!;
      const memberGenomes = r.ranked.map((x) => x.genome);
      const candidates = r.extinct
        ? [...r.tribe.hallOfFame.map((e) => e.genome), ...memberGenomes]
        : memberGenomes;
      r.tribe.size = size;
      spawns.push({
        tribeId: r.tribe.id,
        genomes: breedGenomes(this.spec, candidates, size, evo, rng),
      });
    }
    this.world.startGeneration(generation + 1, spawns);
  }
}

export function createEvolutionRun(options: EvolutionRunOptions): EvolutionRun {
  return new EvolutionRun(options);
}
