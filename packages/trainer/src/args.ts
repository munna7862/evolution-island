import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseSeed } from '@evolution-island/shared';
import {
  DEFAULT_CONFIG,
  MAP_PRESETS,
  type MapPresetId,
  type Seed,
} from '@evolution-island/sim-core';

/** What `pnpm train ...` asked for (plan §4 Sprint 3.3). */
export interface TrainOptions {
  readonly preset: MapPresetId;
  readonly seeds: readonly Seed[];
  readonly generations: number;
  /** One seed: the run folder. Several seeds: the parent of one `<preset>-<seed>` folder each. */
  readonly out: string;
  /**
   * Checkpoint every N generations (plus generation 1 and the last one); null = the config's
   * `benchmarkInterval` (known once the `--config` file is read).
   */
  readonly saveEvery: number | null;
  /** `--config`: a JSON file merged onto `DEFAULT_CONFIG` (null = the defaults). */
  readonly configPath: string | null;
  /** Worker threads for several seeds. */
  readonly workers: number;
  /** Overwrite a run already in the output folder. */
  readonly force: boolean;
  /** Print only the summary, no per-checkpoint progress. */
  readonly quiet: boolean;
}

export type TrainCommand =
  { readonly kind: 'help' } | { readonly kind: 'train'; readonly options: TrainOptions };

/** Bad command line: printed with the usage text, exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const DEFAULT_PRESET: MapPresetId = 'medium';
export const DEFAULT_SEED = 42;
export const DEFAULT_GENERATIONS = 500;
/** Seed lists longer than this are almost certainly a typo (`1-10000`). */
export const MAX_SEEDS = 1000;

export const USAGE = `Usage: pnpm train [options]

  --preset <small|medium|large|huge>  map preset (default ${DEFAULT_PRESET})
  --seed <seed>                       one seed, a number or any text (default ${DEFAULT_SEED})
  --seeds <list>                      several seeds in parallel, e.g. 1-10 or 1,4,7-9
  --generations <n>                   generations to run (default ${DEFAULT_GENERATIONS})
  --out <dir>                         run folder; with --seeds the parent of one folder per seed
                                      (default runs/<preset>-<seed>, runs/<preset>-seeds-<list>)
  --save-every <n>                    checkpoint every n generations (default: the config's
                                      benchmarkInterval, ${DEFAULT_CONFIG.evolution.benchmarkInterval});
                                      generation 1 and the last one are always saved
  --config <file>                     JSON merged onto the default config, e.g.
                                      {"evolution": {"mutationSigma": 0.3}}; a full config
                                      (the "config" object copied out of a run.json) works
                                      too. Runs store the full config.
  --workers <n>                       worker threads for --seeds (default: CPU count - 1)
  --force                             overwrite a run already in the output folder
  --quiet                             print only the summary
  --help                              show this text

Example: pnpm train --preset medium --seed 42 --generations 500 --out runs/medium-42/`;

function positiveInt(flag: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value < 1) {
    throw new UsageError(`${flag} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** `1-10`, `3`, `1,4,7-9` → ascending-as-written integer seeds, no duplicates. */
export function parseSeedList(spec: string): number[] {
  const seeds: number[] = [];
  const seen = new Set<number>();
  const add = (seed: number): void => {
    if (seen.has(seed)) throw new UsageError(`--seeds lists seed ${seed} twice`);
    seen.add(seed);
    seeds.push(seed);
    if (seeds.length > MAX_SEEDS)
      throw new UsageError(`--seeds lists more than ${MAX_SEEDS} seeds`);
  };
  for (const part of spec.split(',')) {
    const match = /^\s*(-?\d+)\s*(?:-\s*(-?\d+)\s*)?$/.exec(part);
    if (match === null) {
      throw new UsageError(`--seeds must look like 1-10 or 1,4,7-9, got "${spec}"`);
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) {
      throw new UsageError(`--seeds range "${part.trim()}" is not a valid ascending range`);
    }
    if (to - from >= MAX_SEEDS) throw new UsageError(`--seeds lists more than ${MAX_SEEDS} seeds`);
    for (let seed = from; seed <= to; seed++) add(seed);
  }
  return seeds;
}

/** Folder-safe name for a seed: anything outside [A-Za-z0-9._-] becomes `_`. */
export function seedLabel(seed: Seed): string {
  return String(seed).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** `<preset>-<seed>`: a seed's run folder name. */
export function runFolderName(preset: MapPresetId, seed: Seed): string {
  return `${preset}-${seedLabel(seed)}`;
}

function isPresetId(value: string): value is MapPresetId {
  return Object.prototype.hasOwnProperty.call(MAP_PRESETS, value);
}

/** Parses the trainer's command line. Throws `UsageError` for anything it can't run. */
export function parseTrainArgs(argv: readonly string[], cpus: number): TrainCommand {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        preset: { type: 'string' },
        seed: { type: 'string' },
        seeds: { type: 'string' },
        generations: { type: 'string' },
        out: { type: 'string' },
        'save-every': { type: 'string' },
        config: { type: 'string' },
        workers: { type: 'string' },
        force: { type: 'boolean' },
        quiet: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error: unknown) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (values.help === true) return { kind: 'help' };

  const preset = values.preset ?? DEFAULT_PRESET;
  if (!isPresetId(preset)) {
    throw new UsageError(
      `--preset must be one of ${Object.keys(MAP_PRESETS).join(', ')}, got "${preset}"`,
    );
  }
  if (values.seed !== undefined && values.seeds !== undefined) {
    throw new UsageError('use either --seed or --seeds, not both');
  }
  let seeds: Seed[];
  if (values.seeds !== undefined) {
    seeds = parseSeedList(values.seeds);
  } else {
    const raw = values.seed ?? String(DEFAULT_SEED);
    if (raw.trim().length === 0) throw new UsageError('--seed must not be empty');
    seeds = [parseSeed(raw)];
  }
  const generations = positiveInt('--generations', values.generations, DEFAULT_GENERATIONS);
  const saveEvery =
    values['save-every'] === undefined
      ? null
      : positiveInt('--save-every', values['save-every'], 1);
  const configPath = values.config ?? null;
  if (configPath !== null && configPath.trim().length === 0) {
    throw new UsageError('--config must not be empty');
  }
  const defaultWorkers = Math.max(1, Math.min(seeds.length, cpus - 1));
  const workers = positiveInt('--workers', values.workers, defaultWorkers);

  let out = values.out;
  if (out === undefined) {
    out =
      seeds.length === 1
        ? join('runs', runFolderName(preset, seeds[0]!))
        : join('runs', `${preset}-seeds-${values.seeds!.replace(/[^0-9-]+/g, '_')}`);
  } else if (out.trim().length === 0) {
    throw new UsageError('--out must not be empty');
  }

  return {
    kind: 'train',
    options: {
      preset,
      seeds,
      generations,
      out,
      saveEvery,
      configPath,
      workers,
      force: values.force === true,
      quiet: values.quiet === true,
    },
  };
}
