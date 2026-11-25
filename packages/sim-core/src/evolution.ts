import { createBenchmarkArena, runBenchmark, type BenchmarkArena } from './benchmark.js';
import {
  brainPolicyForConfig,
  brainSpecFromConfig,
  validateGenome,
  type BrainSpec,
} from './brain.js';
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
import type { RngState, RngStream, Seed } from './rng.js';
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

/**
 * Next genomes of a tribe that went extinct (respawn mode, plan §2.5): its best hall-of-fame
 * genome returns unchanged, and the rest are bred from this generation's members (best fitness
 * first) like any tribe's. The hall of fame only becomes the parent pool when there are no
 * members. Putting the whole hall of fame ahead of the members instead let it fill the parent
 * slots, which froze tribes that never had a survivor yet (Sprint 3.2 review).
 */
export function respawnGenomes(
  spec: BrainSpec,
  hallOfFame: readonly HallOfFameEntry[],
  members: readonly Float32Array[],
  count: number,
  evolution: EvolutionConfig,
  rng: RngStream,
): Float32Array[] {
  if (members.length === 0) {
    return breedGenomes(
      spec,
      hallOfFame.map((e) => e.genome),
      count,
      evolution,
      rng,
    );
  }
  const champion = hallOfFame[0];
  if (champion === undefined || count < 1) {
    return breedGenomes(spec, members, count, evolution, rng);
  }
  return [
    Float32Array.from(champion.genome),
    ...breedGenomes(spec, members, count - 1, evolution, rng),
  ];
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
 * clamped to [min, max]: share_i = clamp(λ·score_i, min, max), with the one scale λ that makes the
 * shares add up to the budget ("water filling"). Integer sizes by largest remainder (ties → lower
 * index). Non-positive scores count as 0 (such a tribe gets `min`); if no tribe scored, the budget
 * is split evenly. Places the scoring tribes can't take because of `max` go to the tribes held at
 * `min` (extinct, or scored nothing), one at a time in index order, up to `max`. The total equals
 * the budget whenever the clamps allow it; otherwise every tribe sits at the clamp nearest the
 * budget.
 */
export function allocateTribeSizes(
  tribes: readonly TribeAllocation[],
  budget: number,
  min: number,
  max: number,
): number[] {
  const sizes = tribes.map((t) => (t.kind === 'min' ? min : 0));
  const free: number[] = [];
  tribes.forEach((t, i) => {
    if (t.kind === 'share') free.push(i);
  });
  if (free.length === 0) {
    return sizes;
  }
  const rawScore = (i: number): number => {
    const t = tribes[i]!;
    return t.kind === 'share' && t.score > 0 ? t.score : 0;
  };
  const anyScore = free.some((i) => rawScore(i) > 0);
  const weightOf = (i: number): number => (anyScore ? rawScore(i) : 1);
  const freeBudget = budget - sizes.reduce((acc, s) => acc + s, 0);

  const shares = clampedProportionalShares(free.map(weightOf), freeBudget, min, max);
  let assigned = 0;
  free.forEach((i, k) => {
    sizes[i] = Math.floor(shares[k]!);
    assigned += sizes[i];
  });
  const byRemainder = free
    .map((i, k) => ({ i, remainder: shares[k]! - sizes[i]! }))
    .sort((a, b) => {
      if (a.remainder !== b.remainder) return b.remainder - a.remainder;
      return a.i - b.i;
    });
  let left = Math.max(0, Math.round(freeBudget - assigned));
  for (const { i } of byRemainder) {
    if (left === 0) break;
    if (sizes[i]! >= max) continue;
    sizes[i] = sizes[i]! + 1;
    left--;
  }
  // Places the scoring tribes can't take (all at `max`) go to the tribes held at `min`, one at a
  // time in index order, up to `max` (Sprint 4.2): otherwise Medium shrank to 3 × 25 + 100 = 175
  // whenever one tribe alone survived (plan §2.5). A tribe that scored nothing (every tribe died
  // out, it gathered no food) is held at `min` like an extinct one, so it takes them too.
  const heldAtMin = tribes.flatMap((t, i) =>
    t.kind === 'min' || (t.kind === 'share' && anyScore && rawScore(i) === 0) ? [i] : [],
  );
  for (let open = true; left > 0 && open;) {
    open = false;
    for (const i of heldAtMin) {
      if (left === 0) break;
      if (sizes[i]! >= max) continue;
      sizes[i] = sizes[i]! + 1;
      left--;
      open = true;
    }
  }
  return sizes;
}

/**
 * Real-valued shares clamp(λ·w_i, min, max) adding up to `budget` (weights ≥ 0). The sum is a
 * non-decreasing, piecewise-linear function of λ with breakpoints at min/w_i and max/w_i, so the
 * right λ lies between two neighbouring breakpoints, where the set of unclamped tribes is fixed
 * and λ follows from one division. Budgets outside [Σ at λ=0, Σ at λ=∞] give those extremes.
 */
function clampedProportionalShares(
  weights: readonly number[],
  budget: number,
  min: number,
  max: number,
): number[] {
  const at = (lambda: number): number[] =>
    weights.map((w) => Math.max(min, Math.min(max, lambda * w)));
  const sum = (values: readonly number[]): number => values.reduce((acc, v) => acc + v, 0);

  const breakpoints = [
    ...new Set(weights.filter((w) => w > 0).flatMap((w) => [min / w, max / w])),
  ].sort((a, b) => a - b);
  let low = 0;
  if (sum(at(low)) >= budget || breakpoints.length === 0) {
    return at(low);
  }
  for (const high of breakpoints) {
    if (sum(at(high)) < budget) {
      low = high;
      continue;
    }
    // Between `low` and `high` each tribe is either clamped (same value at both ends) or free.
    const mid = (low + high) / 2;
    let clampedTotal = 0;
    let freeWeight = 0;
    for (const w of weights) {
      const share = mid * w;
      if (share <= min) clampedTotal += min;
      else if (share >= max) clampedTotal += max;
      else freeWeight += w;
    }
    return freeWeight > 0 ? at((budget - clampedTotal) / freeWeight) : at(high);
  }
  return at(low);
}

export interface HallOfFameEntry {
  readonly genome: Float32Array;
  readonly benchmarkScore: number;
  readonly generation: number;
}

/** Same weights, bit for bit (as far as the brain can tell: `0 === -0`). */
export function sameGenome(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The hall-of-fame entry holding exactly this genome, if any. */
export function findInHallOfFame(
  hallOfFame: readonly HallOfFameEntry[],
  genome: Float32Array,
): HallOfFameEntry | undefined {
  return hallOfFame.find((e) => sameGenome(e.genome, genome));
}

/**
 * Inserts `entry` and keeps the best `size` by benchmark score (ties → earlier generation).
 * A genome already in the hall of fame is not added twice (Sprint 3.3 review): an elite can be
 * champion again later, and its benchmark score is the same, so the copy would only take the
 * place of another champion.
 */
export function addToHallOfFame(
  hallOfFame: HallOfFameEntry[],
  entry: HallOfFameEntry,
  size: number,
): void {
  if (findInHallOfFame(hallOfFame, entry.genome) !== undefined) return;
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
  /** Mean territory % over the generation (Sprint 4.2; the last recount before). */
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

/** One tribe of an `EvolutionStart`. */
export interface TribeStart {
  readonly tribeId: number;
  /** False for a tribe already eliminated (battle royale); it then needs no genomes. */
  readonly alive: boolean;
  /** One creature per genome, spawned in this order. */
  readonly genomes: readonly Float32Array[];
  /** Taken over as the tribe's hall of fame (best benchmark score first). */
  readonly hallOfFame: readonly HallOfFameEntry[];
}

/**
 * Starts a run from given genomes instead of random generation-1 genomes, e.g. a saved
 * checkpoint's champions (Sprint 3.3). Lists every tribe of the map, in any order.
 */
export interface EvolutionStart {
  readonly generation: number;
  readonly tribes: readonly TribeStart[];
}

/** The RNG streams a run's world uses, by name (Sprint 5.1). */
export type RunRngStates = Readonly<
  Record<'map' | 'spawn' | 'evolution' | 'tick' | 'policy', RngState>
>;

/**
 * A run between two generations (Sprint 5.1): everything needed to continue it exactly. The world
 * right after `World.startGeneration` depends only on the map, the generation, the spawns and the
 * RNG streams and tick count *before* that call, so those are what is kept.
 */
export interface EvolutionRunState {
  readonly generation: number;
  /** `world.tickCount` before the generation started. */
  readonly tickCount: number;
  /** RNG stream states before the generation started. */
  readonly rng: RunRngStates;
  /** What the generation was started with: each living tribe's genomes, in spawn order. */
  readonly spawns: readonly TribeSpawn[];
  readonly tribes: readonly TribeState[];
  readonly finished: boolean;
  readonly winner: number | null;
}

export interface EvolutionRunOptions {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly config?: SimConfig;
  /** Omitted: generation 1 with random genomes drawn from `rng.evolution`. */
  readonly start?: EvolutionStart;
  /** Continue a run from `captureState()` (Sprint 5.1); `start` is then ignored. */
  readonly resume?: EvolutionRunState;
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
  /** The last generation start: what `captureState` saves (Sprint 5.1). */
  private lastStart: Omit<EvolutionRunState, 'tribes' | 'finished' | 'winner'> | null = null;

  constructor(options: EvolutionRunOptions) {
    this.config = options.config ?? DEFAULT_CONFIG;
    this.spec = brainSpecFromConfig(this.config);
    this.world = createWorld({
      preset: options.preset,
      seed: options.seed,
      config: this.config,
      populate: false,
      policy: brainPolicyForConfig(this.config, (c) => c.genome),
    });
    const tribeIds = this.world.map.spawnZones.map((z) => z.tribeId).sort((a, b) => a - b);
    if (options.resume !== undefined) {
      this.tribes = this.resumeFrom(options.resume, tribeIds);
      return;
    }
    if (options.start !== undefined) {
      this.tribes = this.startFrom(options.start, tribeIds);
      return;
    }
    const startSize = this.config.presets[options.preset].startingCreaturesPerTribe;
    this.tribes = tribeIds.map((id) => ({
      id,
      size: startSize,
      alive: true,
      hallOfFame: [],
      history: [],
    }));
    const rng = this.world.rng.evolution;
    const range = this.config.evolution.initialWeightRange;
    this.beginGeneration(
      1,
      this.tribes.map((t) => ({
        tribeId: t.id,
        genomes: Array.from({ length: t.size }, () => randomGenome(this.spec, rng, range)),
      })),
    );
  }

  /** Validates `start` against the map and brain, then spawns its genomes (no RNG draws). */
  private startFrom(start: EvolutionStart, tribeIds: readonly number[]): TribeState[] {
    const byId = new Map<number, TribeStart>();
    for (const t of start.tribes) {
      if (!tribeIds.includes(t.tribeId)) {
        throw new RangeError(`Start lists tribe ${t.tribeId}, which this map does not have`);
      }
      if (byId.has(t.tribeId)) {
        throw new RangeError(`Start lists tribe ${t.tribeId} twice`);
      }
      byId.set(t.tribeId, t);
    }
    const tribes = tribeIds.map((id): TribeState => {
      const t = byId.get(id);
      if (t === undefined) {
        throw new RangeError(`Start is missing tribe ${id}`);
      }
      for (const genome of [...t.genomes, ...t.hallOfFame.map((e) => e.genome)]) {
        validateGenome(this.spec, genome);
      }
      if (!t.alive && t.genomes.length > 0) {
        throw new RangeError(`Eliminated tribe ${id} cannot have creatures`);
      }
      const hallOfFame: HallOfFameEntry[] = [];
      for (const e of t.hallOfFame) {
        const entry = { ...e, genome: Float32Array.from(e.genome) };
        addToHallOfFame(hallOfFame, entry, this.config.evolution.hallOfFameSize);
      }
      return { id, size: t.genomes.length, alive: t.alive, hallOfFame, history: [] };
    });
    this.beginGeneration(
      start.generation,
      start.tribes.filter((t) => t.alive).map((t) => ({ tribeId: t.tribeId, genomes: t.genomes })),
    );
    return tribes;
  }

  get generation(): number {
    return this.world.generation;
  }

  /** Starts a world generation, remembering what `captureState` needs to redo it exactly. */
  private beginGeneration(generation: number, spawns: readonly TribeSpawn[]): void {
    const rng = this.world.rng;
    this.lastStart = {
      generation,
      tickCount: this.world.tickCount,
      rng: {
        map: rng.map.getState(),
        spawn: rng.spawn.getState(),
        evolution: rng.evolution.getState(),
        tick: rng.tick.getState(),
        policy: rng.policy.getState(),
      },
      spawns: spawns.map((s) => ({
        tribeId: s.tribeId,
        genomes: s.genomes.map((g) => Float32Array.from(g)),
      })),
    };
    this.world.startGeneration(generation, spawns);
  }

  /**
   * The run between generations (Sprint 5.1), as `restore` needs it: only valid before the first
   * tick of a generation (e.g. right after `runGeneration`), or once the run has finished.
   */
  captureState(): EvolutionRunState {
    const start = this.lastStart;
    if (start === null || (!this.finished && this.world.generationTick !== 0)) {
      throw new Error('captureState: only between generations (call it after runGeneration)');
    }
    return {
      ...start,
      spawns: start.spawns.map((s) => ({
        tribeId: s.tribeId,
        genomes: s.genomes.map((g) => Float32Array.from(g)),
      })),
      tribes: this.tribes.map((t) => ({
        id: t.id,
        size: t.size,
        alive: t.alive,
        hallOfFame: t.hallOfFame.map((e) => ({ ...e, genome: Float32Array.from(e.genome) })),
        history: t.history.map((h) => ({ ...h })),
      })),
      finished: this.finished,
      winner: this.winner,
    };
  }

  /** Rebuilds the run a `captureState` came from: same RNG streams, tick count and spawns. */
  private resumeFrom(state: EvolutionRunState, tribeIds: readonly number[]): TribeState[] {
    const ids = state.tribes.map((t) => t.id).sort((a, b) => a - b);
    if (ids.length !== tribeIds.length || ids.some((id, i) => id !== tribeIds[i])) {
      throw new RangeError(
        `Run state lists tribes ${ids.join(',')}, the map has ${tribeIds.join(',')}`,
      );
    }
    for (const spawn of state.spawns) {
      for (const genome of spawn.genomes) validateGenome(this.spec, genome);
    }
    for (const t of state.tribes) {
      for (const e of t.hallOfFame) validateGenome(this.spec, e.genome);
    }
    const tribes = [...state.tribes]
      .sort((a, b) => a.id - b.id)
      .map((t): TribeState => ({
        id: t.id,
        size: t.size,
        alive: t.alive,
        hallOfFame: t.hallOfFame.map((e) => ({ ...e, genome: Float32Array.from(e.genome) })),
        history: t.history.map((h) => ({ ...h })),
      }));
    this.finished = state.finished;
    this.winner = state.winner;
    const rng = this.world.rng;
    rng.map.setState(state.rng.map);
    rng.spawn.setState(state.rng.spawn);
    rng.evolution.setState(state.rng.evolution);
    rng.tick.setState(state.rng.tick);
    rng.policy.setState(state.rng.policy);
    this.world.tickCount = state.tickCount;
    this.beginGeneration(state.generation, state.spawns);
    return tribes;
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

  /** Battle royale and past its grace period: this generation's end can eliminate tribes. */
  private eliminates(generation: number): boolean {
    const evo = this.config.evolution;
    return evo.extinction === 'battle-royale' && generation >= evo.battleRoyaleFromGeneration;
  }

  private isGenerationOver(): boolean {
    if (this.world.isGenerationOver()) return true;
    if (!this.eliminates(this.world.generation)) return false;
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
      const outcome = tribeOutcome(members, this.world.territoryAverage(tribe.id));
      const score = tribeScore(outcome, evo);
      let benchmarkScore: number | null = null;
      if (benchmarkDue && ranked.length > 0) {
        const champion = ranked[0]!.genome;
        // The arena is deterministic: a champion already in the hall of fame keeps its score
        // (e.g. every creature of a played checkpoint is a hall-of-fame genome).
        const known = findInHallOfFame(tribe.hallOfFame, champion);
        if (known !== undefined) {
          benchmarkScore = known.benchmarkScore;
        } else {
          benchmarkScore = this.benchmark(champion);
          addToHallOfFame(
            tribe.hallOfFame,
            { genome: Float32Array.from(champion), benchmarkScore, generation },
            evo.hallOfFameSize,
          );
        }
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

    if (this.eliminates(generation)) {
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
      r.tribe.size = size;
      spawns.push({
        tribeId: r.tribe.id,
        genomes: r.extinct
          ? respawnGenomes(this.spec, r.tribe.hallOfFame, memberGenomes, size, evo, rng)
          : breedGenomes(this.spec, memberGenomes, size, evo, rng),
      });
    }
    this.beginGeneration(generation + 1, spawns);
  }
}

export function createEvolutionRun(options: EvolutionRunOptions): EvolutionRun {
  return new EvolutionRun(options);
}
