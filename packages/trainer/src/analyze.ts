import { join } from 'node:path';
import {
  applyConfigOverride,
  CHECKPOINT_FILE_NAME,
  CHECKPOINTS_DIR_NAME,
  checkpointDirName,
  parseCheckpoint,
  parseGenome,
  parseRunManifest,
  RUN_MANIFEST_NAME,
} from '@evolution-island/shared';
import {
  Action,
  ACTION_COUNT,
  createBenchmarkArena,
  hashConfig,
  runBenchmarkDetailed,
  type BenchmarkArena,
  type MapPresetId,
  type SimConfig,
} from '@evolution-island/sim-core';
import { STATS_FILE_FORMAT, type StatsRow } from './stats.js';

/**
 * Run analysis (Sprint 4.2): reads trained run folders and computes what the balance bar asks
 * for — which start slot has the highest tribe score, how many tribes are still alive (battle
 * royale), each tribe's late benchmark score and lock-in, and the action mix of each tribe's best
 * hall-of-fame champion in the benchmark arena.
 */

/** A tribe is hard-locked-in when its best creature stays below this fitness (Sprint 3.5). */
export const LOCK_IN_FITNESS = 700;
/** Generations looked at for lock-in. */
export const LOCK_IN_WINDOW = 10;
/** Benchmarks averaged for a tribe's late score (Sprint 3.5 / 4.1). */
export const LATE_BENCHMARKS = 3;
/** A champion is degenerate when more than this share of its actions is `STAY` (plan §4). */
export const DEGENERATE_STAY_SHARE = 0.8;

export interface AnalyzeIo {
  readTextFile(path: string): string;
  /** Entry names of a folder (files and folders). */
  listDir(path: string): string[];
  exists(path: string): boolean;
}

export interface ChampionAnalysis {
  /** Hall-of-fame rank-1 genome of the analysed checkpoint. */
  readonly file: string;
  readonly storedScore: number;
  /** The arena gave exactly the stored score again. */
  readonly reproduced: boolean;
  /** Share of each resolved action (indexed by `Action`), over all living clone-ticks. */
  readonly actionShares: readonly number[];
}

export interface TribeAnalysis {
  readonly tribeId: number;
  /** Tribe score at the analysed generation; null if the tribe was eliminated before it. */
  readonly tribeScore: number | null;
  readonly population: number;
  /** Still in the run after the analysed generation (battle royale eliminates). */
  readonly alive: boolean;
  readonly firstBenchmark: number | null;
  /** Mean of the tribe's last `LATE_BENCHMARKS` benchmarks up to the analysed generation. */
  readonly lateScore: number | null;
  readonly hardLockIn: boolean;
  readonly champion: ChampionAnalysis | null;
}

export interface RunAnalysis {
  readonly dir: string;
  readonly seed: string;
  readonly preset: MapPresetId;
  readonly configHash: string;
  /** The last completed generation. */
  readonly generation: number;
  readonly tribes: readonly TribeAnalysis[];
  /** Tribe (= start slot) with the highest tribe score at `generation`, ties → lowest id. */
  readonly winner: number | null;
  readonly tribesAlive: number;
}

function readStats(dir: string, io: AnalyzeIo): StatsRow[] {
  const parsed: unknown = JSON.parse(io.readTextFile(join(dir, 'stats.json')));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { format?: unknown }).format !== STATS_FILE_FORMAT ||
    !Array.isArray((parsed as { rows?: unknown }).rows)
  ) {
    throw new Error(`${dir}: stats.json is not an ${STATS_FILE_FORMAT} file`);
  }
  return (parsed as { rows: StatsRow[] }).rows;
}

function readConfig(dir: string, io: AnalyzeIo, configHash: string): SimConfig {
  const manifest = JSON.parse(io.readTextFile(join(dir, RUN_MANIFEST_NAME))) as {
    config?: unknown;
  };
  const config = applyConfigOverride(manifest.config);
  if (hashConfig(config) !== configHash) {
    throw new Error(`${dir}: run.json's config does not match its config hash ${configHash}`);
  }
  return config;
}

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * One tribe's numbers from the run's stats rows, up to `generation`: tribe score there, alive
 * (not eliminated: it has a row there and a next size), late score (mean of its last
 * `LATE_BENCHMARKS` benchmarks) and hard lock-in (best creature below `LOCK_IN_FITNESS` in each
 * of its last `LOCK_IN_WINDOW` generations).
 */
export function analyzeTribe(
  tribeId: number,
  rows: readonly StatsRow[],
  generation: number,
): Omit<TribeAnalysis, 'champion'> {
  const mine = rows.filter((r) => r.tribeId === tribeId && r.generation <= generation);
  const at = mine.find((r) => r.generation === generation);
  const benchmarks = mine.filter((r) => r.benchmarkScore !== null);
  const late = benchmarks.slice(-LATE_BENCHMARKS).map((r) => r.benchmarkScore!);
  const window = mine.slice(-LOCK_IN_WINDOW);
  return {
    tribeId,
    tribeScore: at?.tribeScore ?? null,
    population: at?.population ?? 0,
    alive: at !== undefined && at.nextSize > 0,
    firstBenchmark: mine.find((r) => r.generation === 1)?.benchmarkScore ?? null,
    lateScore: late.length > 0 ? mean(late) : null,
    hardLockIn: window.length > 0 && window.every((r) => r.maxFitness < LOCK_IN_FITNESS),
  };
}

function analyzeChampion(
  checkpointDir: string,
  file: string,
  storedScore: number,
  arena: BenchmarkArena,
  io: AnalyzeIo,
): ChampionAnalysis {
  const genome = parseGenome(io.readTextFile(join(checkpointDir, file))).weights;
  const result = runBenchmarkDetailed(arena, genome);
  const total = result.actions.reduce((acc, n) => acc + n, 0);
  return {
    file,
    storedScore,
    reproduced: result.score === storedScore,
    actionShares: result.actions.map((n) => (total > 0 ? n / total : 0)),
  };
}

/**
 * Analyses one run folder at its last completed generation. `arenas` caches benchmark arenas by
 * preset and config hash (every seed of a sweep shares one).
 */
export function analyzeRun(
  dir: string,
  io: AnalyzeIo,
  arenas: Map<string, BenchmarkArena> = new Map(),
): RunAnalysis {
  const manifest = parseRunManifest(io.readTextFile(join(dir, RUN_MANIFEST_NAME)));
  const generation = manifest.completedGenerations;
  const rows = readStats(dir, io);
  const config = readConfig(dir, io, manifest.configHash);
  const arenaKey = `${manifest.preset}:${manifest.configHash}`;
  let arena = arenas.get(arenaKey);
  if (arena === undefined) {
    arena = createBenchmarkArena(manifest.preset, config);
    arenas.set(arenaKey, arena);
  }

  const checkpointDir = join(dir, CHECKPOINTS_DIR_NAME, checkpointDirName(generation));
  const checkpoint = parseCheckpoint(io.readTextFile(join(checkpointDir, CHECKPOINT_FILE_NAME)));
  const tribes = checkpoint.tribes.map((t): TribeAnalysis => {
    const best = t.hallOfFame[0];
    return {
      ...analyzeTribe(t.tribeId, rows, generation),
      champion:
        best === undefined
          ? null
          : analyzeChampion(checkpointDir, best.file, best.benchmarkScore, arena, io),
    };
  });

  const winner = pickWinner(tribes);
  return {
    dir,
    seed: String(manifest.seed),
    preset: manifest.preset,
    configHash: manifest.configHash,
    generation,
    tribes,
    winner,
    tribesAlive: tribes.filter((t) => t.alive).length,
  };
}

/**
 * The tribe (= start slot) with the highest tribe score, ties → lowest id whatever the input
 * order; tribes without a score (eliminated earlier) can't win. Null if no tribe has a score.
 */
export function pickWinner(
  tribes: readonly Pick<TribeAnalysis, 'tribeId' | 'tribeScore'>[],
): number | null {
  let winner: number | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const t of [...tribes].sort((a, b) => a.tribeId - b.tribeId)) {
    if (t.tribeScore !== null && t.tribeScore > best) {
      best = t.tribeScore;
      winner = t.tribeId;
    }
  }
  return winner;
}

/** `root` itself if it holds a run, else its sub-folders that do, sorted by name. */
export function findRunDirs(root: string, io: AnalyzeIo): string[] {
  if (io.exists(join(root, RUN_MANIFEST_NAME))) return [root];
  return io
    .listDir(root)
    .filter((name) => io.exists(join(root, name, RUN_MANIFEST_NAME)))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => join(root, name));
}

export interface AnalysisSummary {
  readonly runs: number;
  /** Runs won by each start slot (tribe id). */
  readonly slotWins: readonly number[];
  readonly runsWithTwoAlive: number;
  readonly champions: number;
  readonly championsReproduced: number;
  /** Champions with more than `DEGENERATE_STAY_SHARE` `STAY`. */
  readonly degenerateChampions: number;
  readonly maxStayShare: number;
  /** Mean share of each action over all champions. */
  readonly meanActionShares: readonly number[];
  /** Mean over runs of (mean late score ÷ mean generation-1 benchmark). */
  readonly meanLateRatio: number;
  readonly meanLateScore: number;
  readonly tribes: number;
  readonly hardLockIns: number;
}

export function summarize(runs: readonly RunAnalysis[]): AnalysisSummary {
  const slots = Math.max(0, ...runs.flatMap((r) => r.tribes.map((t) => t.tribeId + 1)));
  const slotWins = new Array<number>(slots).fill(0);
  for (const r of runs) {
    if (r.winner !== null) slotWins[r.winner] = slotWins[r.winner]! + 1;
  }
  const tribes = runs.flatMap((r) => r.tribes);
  const champions = tribes.flatMap((t) => (t.champion === null ? [] : [t.champion]));
  const stay = champions.map((c) => c.actionShares[Action.STAY]!);
  const meanActionShares = Array.from({ length: ACTION_COUNT }, (_, a) =>
    champions.length > 0 ? mean(champions.map((c) => c.actionShares[a]!)) : 0,
  );
  const ratios: number[] = [];
  const lates: number[] = [];
  for (const r of runs) {
    const late = r.tribes.flatMap((t) => (t.lateScore === null ? [] : [t.lateScore]));
    const first = r.tribes.flatMap((t) => (t.firstBenchmark === null ? [] : [t.firstBenchmark]));
    if (late.length > 0) lates.push(mean(late));
    if (late.length > 0 && first.length > 0) ratios.push(mean(late) / mean(first));
  }
  return {
    runs: runs.length,
    slotWins,
    runsWithTwoAlive: runs.filter((r) => r.tribesAlive >= 2).length,
    champions: champions.length,
    championsReproduced: champions.filter((c) => c.reproduced).length,
    degenerateChampions: stay.filter((s) => s > DEGENERATE_STAY_SHARE).length,
    maxStayShare: stay.length > 0 ? Math.max(...stay) : 0,
    meanActionShares,
    meanLateRatio: ratios.length > 0 ? mean(ratios) : 0,
    meanLateScore: lates.length > 0 ? mean(lates) : 0,
    tribes: tribes.length,
    hardLockIns: tribes.filter((t) => t.hardLockIn).length,
  };
}

const ACTION_LABELS = ['N', 'E', 'S', 'W', 'STAY', 'EAT', 'DRINK', 'ATTACK', 'SHARE'] as const;

function pct(share: number): string {
  return `${(100 * share).toFixed(0)}%`;
}

function round(value: number | null): string {
  return value === null ? '-' : value.toFixed(0);
}

function championMix(c: ChampionAnalysis | null): string {
  if (c === null) return '-';
  const s = c.actionShares;
  const move = s[Action.MOVE_N]! + s[Action.MOVE_E]! + s[Action.MOVE_S]! + s[Action.MOVE_W]!;
  return (
    `move ${pct(move)} stay ${pct(s[Action.STAY]!)} eat ${pct(s[Action.EAT]!)}` +
    ` drink ${pct(s[Action.DRINK]!)} share ${pct(s[Action.SHARE]!)}` +
    (c.reproduced ? '' : ' (stored score NOT reproduced)')
  );
}

/** Human-readable report: one block per run, then the summary. */
export function formatReport(runs: readonly RunAnalysis[], summary: AnalysisSummary): string {
  const lines: string[] = [];
  for (const r of runs) {
    lines.push(
      `${r.preset}-${r.seed} gen ${r.generation}: winner slot ${r.winner ?? '-'}, ` +
        `${r.tribesAlive} tribes alive`,
    );
    for (const t of r.tribes) {
      lines.push(
        `  tribe ${t.tribeId}: score ${round(t.tribeScore)} pop ${t.population}` +
          `${t.alive ? '' : ' (eliminated)'} · bench ${round(t.firstBenchmark)} → late ` +
          `${round(t.lateScore)}${t.hardLockIn ? ' · LOCK-IN' : ''} · champion ${championMix(t.champion)}`,
      );
    }
  }
  lines.push('');
  lines.push(`Runs: ${summary.runs}`);
  lines.push(
    `Start-slot wins: ${summary.slotWins.map((n, i) => `slot ${i}: ${n}`).join(', ')} ` +
      `(most: ${Math.max(0, ...summary.slotWins)})`,
  );
  lines.push(`Runs with ≥ 2 tribes alive at their last generation: ${summary.runsWithTwoAlive}`);
  lines.push(
    `Champions: ${summary.champions} (stored score reproduced: ${summary.championsReproduced}), ` +
      `> ${pct(DEGENERATE_STAY_SHARE)} STAY: ${summary.degenerateChampions}, ` +
      `max STAY ${pct(summary.maxStayShare)}`,
  );
  lines.push(
    `Mean champion action mix: ${summary.meanActionShares
      .map((s, a) => `${ACTION_LABELS[a]!} ${pct(s)}`)
      .join(' ')}`,
  );
  lines.push(
    `Late score: mean ${summary.meanLateScore.toFixed(0)}, mean ratio to generation 1 ` +
      `${summary.meanLateRatio.toFixed(2)}; hard lock-in: ${summary.hardLockIns} of ` +
      `${summary.tribes} tribes`,
  );
  return `${lines.join('\n')}\n`;
}
