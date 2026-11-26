import {
  MAP_PRESETS,
  SIM_VERSION,
  type BrainSpec,
  type EvolutionStart,
  type HallOfFameEntry,
  type MapPresetId,
  type Seed,
  type TribeStart,
} from '@evolution-island/sim-core';
import { assertGenomeCompatible, type LoadedGenome } from './genome-file.js';

/**
 * Files of a trainer run folder (plan §4 Sprint 3.3):
 *
 * ```text
 * <run>/run.json                                  manifest (RunManifest)
 * <run>/stats.json, stats.csv                     per generation and tribe (written by the trainer)
 * <run>/checkpoints/gen-0010/checkpoint.json      CheckpointFile
 * <run>/checkpoints/gen-0010/tribe-0-hof-1.genome.json   genome files (genome-file.ts)
 * ```
 *
 * A checkpoint at generation N is the state after generation N ended: each tribe's hall of fame
 * (best benchmark score first) and the size it was given for the next generation.
 */
export const RUN_FILE_FORMAT = 'evolution-island/run';
export const CHECKPOINT_FILE_FORMAT = 'evolution-island/checkpoint';
export const RUN_FILES_VERSION = 1;

export const RUN_MANIFEST_NAME = 'run.json';
export const CHECKPOINT_FILE_NAME = 'checkpoint.json';
export const CHECKPOINTS_DIR_NAME = 'checkpoints';

const CONFIG_HASH_PATTERN = /^[0-9a-f]{16}$/;
/** Plain file names only: checkpoint entries never point outside their own folder. */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `gen-0010`: zero-padded to 4 digits so folders sort by generation. */
export function checkpointDirName(generation: number): string {
  return `gen-${String(generation).padStart(4, '0')}`;
}

/** `tribe-0-hof-1.genome.json`: rank 1 = best benchmark score. */
export function hallOfFameFileName(tribeId: number, rank: number): string {
  return `tribe-${tribeId}-hof-${rank}.genome.json`;
}

export type RunFileErrorReason =
  'malformed' | 'missing-file' | 'sim-version-mismatch' | 'config-hash-mismatch';

export class RunFileError extends Error {
  readonly reason: RunFileErrorReason;

  constructor(reason: RunFileErrorReason, message: string) {
    super(message);
    this.name = 'RunFileError';
    this.reason = reason;
  }
}

export interface CheckpointHallOfFameEntry {
  /** 1 = best benchmark score. */
  readonly rank: number;
  /** Generation the champion was benchmarked in. */
  readonly generation: number;
  readonly benchmarkScore: number;
  /** Genome file name, in the checkpoint's folder. */
  readonly file: string;
}

export interface CheckpointTribe {
  readonly tribeId: number;
  /** False once eliminated (battle royale). */
  readonly alive: boolean;
  /** Creatures allocated for the generation after this checkpoint. */
  readonly size: number;
  readonly hallOfFame: readonly CheckpointHallOfFameEntry[];
}

export interface CheckpointFile {
  readonly format: typeof CHECKPOINT_FILE_FORMAT;
  readonly fileVersion: number;
  readonly simVersion: number;
  readonly configHash: string;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly generation: number;
  readonly tribes: readonly CheckpointTribe[];
}

export type CheckpointContent = Omit<CheckpointFile, 'format' | 'fileVersion' | 'simVersion'>;

export interface RunTiming {
  /** Wall-clock seconds of the run so far (not deterministic; kept out of checkpoints). */
  readonly elapsedSeconds: number;
  /** World ticks simulated (benchmark-arena ticks not included). */
  readonly ticks: number;
  readonly ticksPerSecond: number;
}

export interface RunManifest {
  readonly format: typeof RUN_FILE_FORMAT;
  readonly fileVersion: number;
  readonly simVersion: number;
  readonly configHash: string;
  readonly brain: BrainSpec;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  /** Generations asked for. */
  readonly generations: number;
  readonly saveEvery: number;
  readonly completedGenerations: number;
  /** Generations that have a checkpoint folder, ascending. */
  readonly checkpoints: readonly number[];
  readonly timing: RunTiming;
  /** The full config the run used (for the record; files are matched by `configHash`). */
  readonly config: unknown;
}

export type RunManifestContent = Omit<RunManifest, 'format' | 'fileVersion' | 'simVersion'>;

export function serializeCheckpoint(content: CheckpointContent): string {
  const file: CheckpointFile = {
    format: CHECKPOINT_FILE_FORMAT,
    fileVersion: RUN_FILES_VERSION,
    simVersion: SIM_VERSION,
    ...content,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function serializeRunManifest(content: RunManifestContent): string {
  const file: RunManifest = {
    format: RUN_FILE_FORMAT,
    fileVersion: RUN_FILES_VERSION,
    simVersion: SIM_VERSION,
    ...content,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Parsing

function malformed(what: string, message: string): RunFileError {
  return new RunFileError('malformed', `Invalid ${what}: ${message}`);
}

type Rec = Record<string, unknown>;

function isPresetId(value: string): value is MapPresetId {
  return Object.prototype.hasOwnProperty.call(MAP_PRESETS, value);
}

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Reader {
  constructor(
    private readonly what: string,
    private readonly record: Rec,
  ) {}

  int(key: string, min = 0): number {
    const v = this.record[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) {
      throw malformed(this.what, `"${key}" must be an integer ≥ ${min}`);
    }
    return v;
  }

  finite(key: string): number {
    const v = this.record[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw malformed(this.what, `"${key}" must be a finite number`);
    }
    return v;
  }

  bool(key: string): boolean {
    const v = this.record[key];
    if (typeof v !== 'boolean') throw malformed(this.what, `"${key}" must be true or false`);
    return v;
  }

  fileName(key: string): string {
    const v = this.record[key];
    if (typeof v !== 'string' || !FILE_NAME_PATTERN.test(v)) {
      throw malformed(this.what, `"${key}" must be a plain file name`);
    }
    return v;
  }

  configHash(): string {
    const v = this.record['configHash'];
    if (typeof v !== 'string' || !CONFIG_HASH_PATTERN.test(v)) {
      throw malformed(this.what, '"configHash" must be 16 lowercase hex digits');
    }
    return v;
  }

  preset(): MapPresetId {
    const v = this.record['preset'];
    if (typeof v !== 'string' || !isPresetId(v)) {
      throw malformed(this.what, `"preset" must be one of ${Object.keys(MAP_PRESETS).join(', ')}`);
    }
    return v;
  }

  seed(): Seed {
    const v = this.record['seed'];
    if ((typeof v === 'number' && Number.isSafeInteger(v)) || typeof v === 'string') return v;
    throw malformed(this.what, '"seed" must be an integer or a string');
  }

  array(key: string): readonly unknown[] {
    const v = this.record[key];
    if (!Array.isArray(v)) throw malformed(this.what, `"${key}" must be an array`);
    return v;
  }

  header(format: string): void {
    if (this.record['format'] !== format) {
      throw malformed(this.what, `"format" must be "${format}"`);
    }
    const version = this.int('fileVersion');
    if (version !== RUN_FILES_VERSION) {
      throw malformed(
        this.what,
        `unsupported fileVersion ${version} (expected ${RUN_FILES_VERSION})`,
      );
    }
  }
}

function parseJsonObject(what: string, text: string): Rec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformed(what, 'not valid JSON');
  }
  if (!isRecord(parsed)) throw malformed(what, 'top level must be an object');
  return parsed;
}

function readEntry(value: unknown): CheckpointHallOfFameEntry {
  if (!isRecord(value)) throw malformed('checkpoint', 'hall-of-fame entries must be objects');
  const r = new Reader('checkpoint', value);
  return {
    rank: r.int('rank', 1),
    generation: r.int('generation', 1),
    benchmarkScore: r.finite('benchmarkScore'),
    file: r.fileName('file'),
  };
}

function readTribe(value: unknown): CheckpointTribe {
  if (!isRecord(value)) throw malformed('checkpoint', 'tribes must be objects');
  const r = new Reader('checkpoint', value);
  const hallOfFame = r
    .array('hallOfFame')
    .map(readEntry)
    .sort((a, b) => a.rank - b.rank);
  return { tribeId: r.int('tribeId'), alive: r.bool('alive'), size: r.int('size'), hallOfFame };
}

/** Parses and structurally validates `checkpoint.json` (hall of fame sorted by rank). */
export function parseCheckpoint(text: string): CheckpointFile {
  const record = parseJsonObject('checkpoint', text);
  const r = new Reader('checkpoint', record);
  r.header(CHECKPOINT_FILE_FORMAT);
  const tribes = r.array('tribes').map(readTribe);
  const ids = new Set(tribes.map((t) => t.tribeId));
  if (ids.size !== tribes.length) throw malformed('checkpoint', 'a tribe is listed twice');
  return {
    format: CHECKPOINT_FILE_FORMAT,
    fileVersion: RUN_FILES_VERSION,
    simVersion: r.int('simVersion'),
    configHash: r.configHash(),
    preset: r.preset(),
    seed: r.seed(),
    generation: r.int('generation', 1),
    tribes,
  };
}

/** What `run.json` tells a viewer (the stored config is not parsed). */
export interface RunManifestInfo {
  readonly simVersion: number;
  readonly configHash: string;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly generations: number;
  readonly completedGenerations: number;
  readonly checkpoints: readonly number[];
}

export function parseRunManifest(text: string): RunManifestInfo {
  const r = new Reader('run manifest', parseJsonObject('run manifest', text));
  r.header(RUN_FILE_FORMAT);
  const checkpoints = r.array('checkpoints').map((g) => {
    if (typeof g !== 'number' || !Number.isSafeInteger(g) || g < 1) {
      throw malformed('run manifest', '"checkpoints" must list generation numbers');
    }
    return g;
  });
  return {
    simVersion: r.int('simVersion'),
    configHash: r.configHash(),
    preset: r.preset(),
    seed: r.seed(),
    generations: r.int('generations', 1),
    completedGenerations: r.int('completedGenerations'),
    checkpoints,
  };
}

// ---------------------------------------------------------------------------------------------
// Playing a checkpoint

export interface CheckpointExpectations {
  readonly brain: BrainSpec;
  readonly configHash: string;
  /** Defaults to this build's SIM_VERSION. */
  readonly simVersion?: number;
}

/** What to do about a run this build can't play (until Sprint 5.1 migrates old files). */
const RETRAIN_HINT = 'Train it again with this build (pnpm train) to watch it.';

/**
 * Refuses checkpoints made by another simulation version or config (plan §3.3). The messages are
 * shown to the user as they are, so they say why and what to do.
 */
export function assertCheckpointCompatible(
  checkpoint: CheckpointFile,
  expected: CheckpointExpectations,
): void {
  const simVersion = expected.simVersion ?? SIM_VERSION;
  if (checkpoint.simVersion !== simVersion) {
    throw new RunFileError(
      'sim-version-mismatch',
      `the run was made by simVersion ${checkpoint.simVersion}, this build is simVersion ` +
        `${simVersion}: the simulation rules changed since, so its champions would not behave ` +
        `as they were trained. ${RETRAIN_HINT}`,
    );
  }
  if (checkpoint.configHash !== expected.configHash) {
    throw new RunFileError(
      'config-hash-mismatch',
      `the run was trained with other settings (config ${checkpoint.configHash}; this build's ` +
        `default config is ${expected.configHash}): it was trained with pnpm train --config (for ` +
        `example NEAT brains), or a value in config.ts changed since. The viewer plays runs made ` +
        `with the default config. ${RETRAIN_HINT}`,
    );
  }
}

/**
 * The `EvolutionRun` start that plays a checkpoint: every tribe gets its saved size, creature i
 * running hall-of-fame genome i mod K (best first), and keeps its hall of fame. `genomes` maps
 * the checkpoint's file names to parsed genome files; each must fit `expected`.
 */
export function checkpointStart(
  checkpoint: CheckpointFile,
  genomes: ReadonlyMap<string, LoadedGenome>,
  expected: CheckpointExpectations,
): EvolutionStart {
  assertCheckpointCompatible(checkpoint, expected);
  const tribes = checkpoint.tribes.map((tribe): TribeStart => {
    const hallOfFame: HallOfFameEntry[] = tribe.hallOfFame.map((entry) => {
      const genome = genomes.get(entry.file);
      if (genome === undefined) {
        throw new RunFileError(
          'missing-file',
          `Checkpoint generation ${checkpoint.generation} needs ${entry.file}, which was not loaded`,
        );
      }
      assertGenomeCompatible(genome, {
        brain: expected.brain,
        configHash: expected.configHash,
        ...(expected.simVersion === undefined ? {} : { simVersion: expected.simVersion }),
      });
      return {
        genome: genome.weights,
        benchmarkScore: entry.benchmarkScore,
        generation: entry.generation,
      };
    });
    const size = tribe.alive ? tribe.size : 0;
    if (size > 0 && hallOfFame.length === 0) {
      throw malformed('checkpoint', `tribe ${tribe.tribeId} has creatures but no hall of fame`);
    }
    return {
      tribeId: tribe.tribeId,
      alive: tribe.alive,
      genomes: Array.from({ length: size }, (_, i) => hallOfFame[i % hallOfFame.length]!.genome),
      hallOfFame,
    };
  });
  return { generation: checkpoint.generation, tribes };
}
