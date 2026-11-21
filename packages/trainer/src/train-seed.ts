import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  CHECKPOINT_FILE_NAME,
  CHECKPOINTS_DIR_NAME,
  checkpointDirName,
  hallOfFameFileName,
  RUN_MANIFEST_NAME,
  serializeCheckpoint,
  serializeGenome,
  serializeRunManifest,
  type CheckpointTribe,
} from '@evolution-island/shared';
import {
  createEvolutionRun,
  DEFAULT_CONFIG,
  hashConfig,
  type EvolutionRun,
  type MapPresetId,
  type Seed,
  type SimConfig,
} from '@evolution-island/sim-core';
import { statsRowsFor, statsToCsv, statsToJson, type StatsRow } from './stats.js';

/** One seed's training run. Plain data, so it can be posted to a worker thread. */
export interface SeedJob {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly generations: number;
  readonly saveEvery: number;
  /** The run folder. */
  readonly outDir: string;
  readonly force: boolean;
  /** Defaults to `DEFAULT_CONFIG` (tests pass short generations). */
  readonly config?: SimConfig;
}

export interface SeedProgress {
  readonly seed: Seed;
  /** Last completed generation. */
  readonly generation: number;
  readonly generations: number;
  readonly checkpoint: boolean;
  readonly ticks: number;
  readonly elapsedSeconds: number;
  readonly ticksPerSecond: number;
  /** Per tribe: latest benchmark-arena score so far (null before the first). */
  readonly benchmark: readonly (number | null)[];
  /** Per tribe: size for the next generation. */
  readonly sizes: readonly number[];
}

export interface SeedSummary {
  readonly seed: Seed;
  readonly preset: MapPresetId;
  readonly outDir: string;
  readonly completedGenerations: number;
  readonly ticks: number;
  readonly elapsedSeconds: number;
  readonly ticksPerSecond: number;
  /** Per tribe: generation-1 benchmark score. */
  readonly firstBenchmark: readonly (number | null)[];
  /** Per tribe: latest benchmark score. */
  readonly lastBenchmark: readonly (number | null)[];
  readonly checkpoints: readonly number[];
}

/** Generation 1, every `saveEvery` generations, and the run's last generation. */
export function isCheckpointGeneration(
  generation: number,
  saveEvery: number,
  last: boolean,
): boolean {
  return last || generation === 1 || generation % saveEvery === 0;
}

const RUN_FILES = [RUN_MANIFEST_NAME, 'stats.json', 'stats.csv', CHECKPOINTS_DIR_NAME];

/** Creates the folder; refuses to overwrite an earlier run unless `force` (then clears it). */
function prepareRunFolder(outDir: string, force: boolean): void {
  if (existsSync(join(outDir, RUN_MANIFEST_NAME))) {
    if (!force) {
      throw new Error(`${outDir} already holds a run (run.json); pass --force to overwrite it`);
    }
    for (const name of RUN_FILES) {
      rmSync(join(outDir, name), { recursive: true, force: true });
    }
  }
  mkdirSync(outDir, { recursive: true });
}

function writeCheckpoint(outDir: string, run: EvolutionRun, generation: number, seed: Seed): void {
  const dir = join(outDir, CHECKPOINTS_DIR_NAME, checkpointDirName(generation));
  mkdirSync(dir, { recursive: true });
  const configHash = hashConfig(run.config);
  const tribes = run.tribes.map((tribe): CheckpointTribe => {
    const hallOfFame = tribe.hallOfFame.map((entry, i) => {
      const file = hallOfFameFileName(tribe.id, i + 1);
      writeFileSync(join(dir, file), serializeGenome(run.spec, entry.genome, configHash));
      return {
        rank: i + 1,
        generation: entry.generation,
        benchmarkScore: entry.benchmarkScore,
        file,
      };
    });
    return {
      tribeId: tribe.id,
      alive: tribe.alive,
      size: tribe.alive ? tribe.size : 0,
      hallOfFame,
    };
  });
  writeFileSync(
    join(dir, CHECKPOINT_FILE_NAME),
    serializeCheckpoint({ configHash, preset: run.world.preset, seed, generation, tribes }),
  );
}

/** Read through a call: TypeScript would keep the loop condition's narrowing of the field. */
function runEnded(run: EvolutionRun): boolean {
  return run.finished;
}

function latestBenchmarks(run: EvolutionRun): (number | null)[] {
  return run.tribes.map((t) => {
    for (let i = t.history.length - 1; i >= 0; i--) {
      const score = t.history[i]!.benchmarkScore;
      if (score !== null) return score;
    }
    return null;
  });
}

/**
 * Runs one seed for `job.generations` generations (or until a battle royale ends) and writes the
 * run folder: checkpoints (hall-of-fame genome files + `checkpoint.json`), `stats.json`,
 * `stats.csv` and `run.json`, refreshed at every checkpoint so a killed run leaves a consistent
 * folder. Checkpoints and stats depend only on the job; wall-clock figures go to `run.json`'s
 * `timing` and to the progress callback.
 */
export function trainSeed(
  job: SeedJob,
  onProgress?: (progress: SeedProgress) => void,
  now: () => number = () => performance.now(),
): SeedSummary {
  prepareRunFolder(job.outDir, job.force);
  const config = job.config ?? DEFAULT_CONFIG;
  const run = createEvolutionRun({ preset: job.preset, seed: job.seed, config });
  const rows: StatsRow[] = [];
  const checkpoints: number[] = [];
  const started = now();
  let completed = 0;

  const timing = () => {
    const elapsedSeconds = (now() - started) / 1000;
    const ticks = run.world.tickCount;
    return {
      elapsedSeconds,
      ticks,
      ticksPerSecond: elapsedSeconds > 0 ? ticks / elapsedSeconds : 0,
    };
  };

  while (!run.finished && run.generation <= job.generations) {
    const generation = run.generation;
    run.runGeneration();
    completed = generation;
    rows.push(...statsRowsFor(run, generation));
    const last = runEnded(run) || generation === job.generations;
    const checkpoint = isCheckpointGeneration(generation, job.saveEvery, last);
    if (checkpoint) {
      writeCheckpoint(job.outDir, run, generation, job.seed);
      checkpoints.push(generation);
      writeFileSync(join(job.outDir, 'stats.json'), statsToJson(rows));
      writeFileSync(join(job.outDir, 'stats.csv'), statsToCsv(rows));
      writeFileSync(
        join(job.outDir, RUN_MANIFEST_NAME),
        serializeRunManifest({
          configHash: hashConfig(config),
          brain: run.spec,
          preset: job.preset,
          seed: job.seed,
          generations: job.generations,
          saveEvery: job.saveEvery,
          completedGenerations: generation,
          checkpoints,
          timing: timing(),
          config,
        }),
      );
    }
    onProgress?.({
      seed: job.seed,
      generation,
      generations: job.generations,
      checkpoint,
      ...timing(),
      benchmark: latestBenchmarks(run),
      sizes: run.tribes.map((t) => (t.alive ? t.size : 0)),
    });
  }

  const firstBenchmark = run.tribes.map(
    (t) => t.history.find((h) => h.generation === 1)?.benchmarkScore ?? null,
  );
  return {
    seed: job.seed,
    preset: job.preset,
    outDir: job.outDir,
    completedGenerations: completed,
    ...timing(),
    firstBenchmark,
    lastBenchmark: latestBenchmarks(run),
    checkpoints,
  };
}
