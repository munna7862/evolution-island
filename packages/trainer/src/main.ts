import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrainArgs, runFolderName, USAGE, UsageError, type TrainOptions } from './args.js';
import { banner } from './banner.js';
import { runPool } from './pool.js';
import type { SeedJob, SeedProgress, SeedSummary } from './train-seed.js';

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
  /** Logical CPUs, for the default worker count. */
  readonly cpus: number;
}

/** How seeds are run: one seed in this thread, several on worker threads. */
export interface SeedRunners {
  inProcess(job: SeedJob, onProgress: (p: SeedProgress) => void): Promise<SeedSummary>;
  inWorker(job: SeedJob, onProgress: (p: SeedProgress) => void): Promise<SeedSummary>;
}

function formatScores(scores: readonly (number | null)[]): string {
  return scores.map((s) => (s === null ? '-' : s.toFixed(0))).join('/');
}

export function formatProgress(p: SeedProgress): string {
  return (
    `[seed ${String(p.seed)}] gen ${p.generation}/${p.generations}` +
    ` · ${Math.round(p.ticksPerSecond)} ticks/s · ${p.elapsedSeconds.toFixed(1)} s` +
    ` · bench ${formatScores(p.benchmark)} · sizes ${p.sizes.join('/')}`
  );
}

function meanOf(scores: readonly (number | null)[]): number | null {
  const known = scores.filter((s): s is number => s !== null);
  return known.length === 0 ? null : known.reduce((a, s) => a + s, 0) / known.length;
}

export function formatSummary(s: SeedSummary): string {
  return (
    `[seed ${String(s.seed)}] done: ${s.completedGenerations} generations, ${s.ticks} ticks` +
    ` in ${s.elapsedSeconds.toFixed(1)} s (${Math.round(s.ticksPerSecond)} ticks/s)` +
    ` · bench ${formatScores(s.firstBenchmark)} → ${formatScores(s.lastBenchmark)} · ${s.outDir}`
  );
}

const SUMMARY_COLUMNS = [
  'seed',
  'completedGenerations',
  'ticks',
  'elapsedSeconds',
  'ticksPerSecond',
  'meanFirstBenchmark',
  'meanLastBenchmark',
  'outDir',
] as const;

function writeMultiSeedSummary(out: string, summaries: readonly SeedSummary[]): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify({ seeds: summaries }, null, 2)}\n`);
  const rows = summaries.map((s) => {
    const cells: Record<(typeof SUMMARY_COLUMNS)[number], string> = {
      seed: String(s.seed),
      completedGenerations: String(s.completedGenerations),
      ticks: String(s.ticks),
      elapsedSeconds: s.elapsedSeconds.toFixed(3),
      ticksPerSecond: s.ticksPerSecond.toFixed(1),
      meanFirstBenchmark: String(meanOf(s.firstBenchmark) ?? ''),
      meanLastBenchmark: String(meanOf(s.lastBenchmark) ?? ''),
      outDir: s.outDir,
    };
    return SUMMARY_COLUMNS.map((c) => cells[c]).join(',');
  });
  writeFileSync(join(out, 'summary.csv'), `${[SUMMARY_COLUMNS.join(','), ...rows].join('\n')}\n`);
}

function jobsFor(options: TrainOptions): SeedJob[] {
  return options.seeds.map((seed) => ({
    preset: options.preset,
    seed,
    generations: options.generations,
    saveEvery: options.saveEvery,
    outDir:
      options.seeds.length === 1
        ? options.out
        : join(options.out, runFolderName(options.preset, seed)),
    force: options.force,
  }));
}

/** The trainer CLI. Returns the exit code: 0 ok, 1 a seed failed, 2 bad command line. */
export async function main(
  argv: readonly string[],
  io: CliIo,
  runners: SeedRunners,
): Promise<number> {
  let command;
  try {
    command = parseTrainArgs(argv, io.cpus);
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    io.error(`Error: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (command.kind === 'help') {
    io.log(USAGE);
    return 0;
  }

  const { options } = command;
  const jobs = jobsFor(options);
  io.log(banner());
  io.log(
    `Training ${options.preset}, ${jobs.length === 1 ? 'seed' : 'seeds'} ` +
      `${options.seeds.map((s) => String(s)).join(', ')}, ${options.generations} generations` +
      (jobs.length > 1 ? ` on ${Math.min(options.workers, jobs.length)} worker threads` : '') +
      ` → ${options.out}`,
  );
  const onProgress = (p: SeedProgress): void => {
    if (p.checkpoint && !options.quiet) io.log(formatProgress(p));
  };

  const settled =
    jobs.length === 1
      ? await runPool(jobs, 1, (job) => runners.inProcess(job, onProgress))
      : await runPool(jobs, options.workers, (job) => runners.inWorker(job, onProgress));

  const summaries: SeedSummary[] = [];
  let failed = 0;
  settled.forEach((result, i) => {
    if (result.ok) {
      summaries.push(result.value);
      io.log(formatSummary(result.value));
    } else {
      failed++;
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      io.error(`[seed ${String(jobs[i]!.seed)}] failed: ${message}`);
    }
  });
  if (jobs.length > 1 && summaries.length > 0) {
    writeMultiSeedSummary(options.out, summaries);
    io.log(`Summary: ${join(options.out, 'summary.csv')}`);
  }
  return failed > 0 ? 1 : 0;
}
