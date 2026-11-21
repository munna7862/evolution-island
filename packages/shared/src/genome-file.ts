import {
  sameBrainSpec,
  SIM_VERSION,
  validateBrainSpec,
  validateGenome,
  type BrainSpec,
} from '@evolution-island/sim-core';

/**
 * Genome files (plan §2.4, §3.3): one genome's weights plus the brain spec, simVersion and config
 * hash it was made with, as JSON. Weights are plain JSON numbers: a float32 widened to a double
 * prints as the shortest string that parses back to the same double, so every weight round-trips
 * exactly (-0 comes back as 0, which computes identically because the forward pass sums from +0).
 */
export const GENOME_FILE_FORMAT = 'evolution-island/genome';
export const GENOME_FILE_VERSION = 1;

/** `hashConfig()` output: 16 lowercase hex digits. */
const CONFIG_HASH_PATTERN = /^[0-9a-f]{16}$/;

export interface GenomeFile {
  readonly format: typeof GENOME_FILE_FORMAT;
  readonly fileVersion: number;
  readonly simVersion: number;
  /** `hashConfig()` of the config the genome evolved under (plan §3.3 "versioned files"). */
  readonly configHash: string;
  readonly brain: BrainSpec;
  readonly weights: readonly number[];
}

export interface LoadedGenome {
  readonly simVersion: number;
  readonly configHash: string;
  readonly brain: BrainSpec;
  readonly weights: Float32Array;
}

/** What a caller needs a loaded genome to match before running it. */
export interface GenomeExpectations {
  readonly brain: BrainSpec;
  /** Defaults to this build's SIM_VERSION. */
  readonly simVersion?: number;
  /** When given, genomes made under a different config are refused too. */
  readonly configHash?: string;
}

export type GenomeFileErrorReason =
  'malformed' | 'brain-spec-mismatch' | 'sim-version-mismatch' | 'config-hash-mismatch';

export class GenomeFileError extends Error {
  readonly reason: GenomeFileErrorReason;

  constructor(reason: GenomeFileErrorReason, message: string) {
    super(message);
    this.name = 'GenomeFileError';
    this.reason = reason;
  }
}

function assertConfigHash(configHash: string): void {
  if (!CONFIG_HASH_PATTERN.test(configHash)) {
    throw new RangeError(`configHash must be 16 lowercase hex digits, got "${configHash}"`);
  }
}

export function serializeGenome(
  brain: BrainSpec,
  weights: Float32Array,
  configHash: string,
): string {
  validateBrainSpec(brain);
  validateGenome(brain, weights);
  assertConfigHash(configHash);
  const file: GenomeFile = {
    format: GENOME_FILE_FORMAT,
    fileVersion: GENOME_FILE_VERSION,
    simVersion: SIM_VERSION,
    configHash,
    brain: {
      formatVersion: brain.formatVersion,
      inputs: brain.inputs,
      hidden: brain.hidden,
      outputs: brain.outputs,
    },
    weights: Array.from(weights),
  };
  return JSON.stringify(file);
}

function malformed(message: string): GenomeFileError {
  return new GenomeFileError('malformed', `Invalid genome file: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw malformed(`"${key}" must be an integer`);
  }
  return value;
}

function readConfigHash(record: Record<string, unknown>): string {
  const value = record['configHash'];
  if (typeof value !== 'string' || !CONFIG_HASH_PATTERN.test(value)) {
    throw malformed('"configHash" must be 16 lowercase hex digits');
  }
  return value;
}

function readBrainSpec(value: unknown): BrainSpec {
  if (!isRecord(value)) {
    throw malformed('"brain" must be an object');
  }
  const brain: BrainSpec = {
    formatVersion: readInteger(value, 'formatVersion'),
    inputs: readInteger(value, 'inputs'),
    hidden: readInteger(value, 'hidden'),
    outputs: readInteger(value, 'outputs'),
  };
  try {
    validateBrainSpec(brain);
  } catch (error: unknown) {
    throw malformed(error instanceof Error ? error.message : String(error));
  }
  return brain;
}

function readWeights(value: unknown, brain: BrainSpec): Float32Array {
  if (!Array.isArray(value)) {
    throw malformed('"weights" must be an array');
  }
  const raw: readonly unknown[] = value;
  const weights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const weight = raw[i];
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw malformed(`weight ${i} is not a finite number`);
    }
    weights[i] = weight;
  }
  try {
    validateGenome(brain, weights);
  } catch (error: unknown) {
    throw malformed(error instanceof Error ? error.message : String(error));
  }
  return weights;
}

/** Parses and structurally validates a genome file. Use `assertGenomeCompatible` before running it. */
export function parseGenome(text: string): LoadedGenome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformed('not valid JSON');
  }
  if (!isRecord(parsed)) {
    throw malformed('top level must be an object');
  }
  if (parsed['format'] !== GENOME_FILE_FORMAT) {
    throw malformed(`"format" must be "${GENOME_FILE_FORMAT}"`);
  }
  const fileVersion = readInteger(parsed, 'fileVersion');
  if (fileVersion !== GENOME_FILE_VERSION) {
    throw malformed(`unsupported fileVersion ${fileVersion} (expected ${GENOME_FILE_VERSION})`);
  }
  const simVersion = readInteger(parsed, 'simVersion');
  const configHash = readConfigHash(parsed);
  const brain = readBrainSpec(parsed['brain']);
  const weights = readWeights(parsed['weights'], brain);
  return { simVersion, configHash, brain, weights };
}

/**
 * Refuses genomes made for a different brain shape or simulation version, and, when the caller
 * names one, a different config (plan §3.3). Migration (zero weights for new inputs/outputs,
 * CLAUDE.md) arrives with the first sprint that adds one.
 */
export function assertGenomeCompatible(genome: LoadedGenome, expected: GenomeExpectations): void {
  const { brain } = expected;
  if (!sameBrainSpec(genome.brain, brain)) {
    const { inputs, hidden, outputs } = genome.brain;
    throw new GenomeFileError(
      'brain-spec-mismatch',
      `Genome is for a ${inputs}-${hidden}-${outputs} brain (format ${genome.brain.formatVersion}), ` +
        `expected ${brain.inputs}-${brain.hidden}-${brain.outputs} (format ${brain.formatVersion})`,
    );
  }
  const simVersion = expected.simVersion ?? SIM_VERSION;
  if (genome.simVersion !== simVersion) {
    throw new GenomeFileError(
      'sim-version-mismatch',
      `Genome was made for simVersion ${genome.simVersion}, this build is simVersion ${simVersion}`,
    );
  }
  if (expected.configHash !== undefined && genome.configHash !== expected.configHash) {
    throw new GenomeFileError(
      'config-hash-mismatch',
      `Genome was made under config ${genome.configHash}, expected config ${expected.configHash}`,
    );
  }
}
