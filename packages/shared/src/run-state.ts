import {
  sameBrainSpec,
  SIM_VERSION,
  type BrainSpec,
  type EvolutionRunState,
  type GenerationStats,
  type HallOfFameEntry,
  type RngState,
  type RunRngStates,
  type TribeSpawn,
  type TribeState,
} from '@evolution-island/sim-core';

/**
 * Run-state files (Sprint 5.1): `resume.json` in a run folder, rewritten at every checkpoint, so
 * `pnpm train --resume` continues a run exactly where it stopped. Weights are JSON numbers (a
 * float32 widened to a double prints as the shortest string that parses back to it).
 */
export const RUN_STATE_FILE_FORMAT = 'evolution-island/run-state';
export const RUN_STATE_FILE_VERSION = 1;
export const RUN_STATE_FILE_NAME = 'resume.json';

export interface RunStateFile {
  readonly simVersion: number;
  readonly configHash: string;
  readonly brain: BrainSpec;
  readonly state: EvolutionRunState;
}

export class RunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStateError';
  }
}

const RNG_NAMES = ['map', 'spawn', 'evolution', 'tick', 'policy'] as const;

export function serializeRunState(file: RunStateFile): string {
  const { state } = file;
  const genome = (g: Float32Array) => Array.from(g);
  return JSON.stringify({
    format: RUN_STATE_FILE_FORMAT,
    fileVersion: RUN_STATE_FILE_VERSION,
    simVersion: file.simVersion,
    configHash: file.configHash,
    brain: { ...file.brain },
    state: {
      generation: state.generation,
      tickCount: state.tickCount,
      rng: state.rng,
      spawns: state.spawns.map((s) => ({ tribeId: s.tribeId, genomes: s.genomes.map(genome) })),
      tribes: state.tribes.map((t) => ({
        id: t.id,
        size: t.size,
        alive: t.alive,
        hallOfFame: t.hallOfFame.map((e) => ({
          generation: e.generation,
          benchmarkScore: e.benchmarkScore,
          genome: genome(e.genome),
        })),
        history: t.history,
      })),
      finished: state.finished,
      winner: state.winner,
    },
  });
}

function fail(message: string): never {
  throw new RunStateError(`Invalid run state file: ${message}`);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`);
  return value;
}

function int(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(`${what} must be an integer`);
  return value;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} must be a finite number`);
  return value;
}

function weights(value: unknown, what: string): Float32Array {
  const raw = list(value, what);
  const out = new Float32Array(raw.length);
  raw.forEach((w, i) => {
    out[i] = finite(w, `${what}[${i}]`);
  });
  return out;
}

function rngState(value: unknown, what: string): RngState {
  const raw = list(value, what);
  if (raw.length !== 4) fail(`${what} must hold 4 numbers`);
  const [a, b, c, d] = raw.map((v, i) => int(v, `${what}[${i}]`));
  return [a!, b!, c!, d!];
}

const STATS_FIELDS = [
  'generation',
  'population',
  'survivors',
  'deaths',
  'avgFitness',
  'maxFitness',
  'foodGathered',
  'territoryPct',
  'kills',
  'tribeScore',
] as const;

function stats(value: unknown, what: string): GenerationStats {
  const r = record(value, what);
  const out: Record<string, number | null> = {};
  for (const key of STATS_FIELDS) out[key] = finite(r[key], `${what}.${key}`);
  out['benchmarkScore'] =
    r['benchmarkScore'] === null ? null : finite(r['benchmarkScore'], `${what}.benchmarkScore`);
  return out as unknown as GenerationStats;
}

/** Parses a run-state file. Use `assertRunStateCompatible` before resuming from it. */
export function parseRunState(text: string): RunStateFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('not valid JSON');
  }
  const top = record(parsed, 'the file');
  if (top['format'] !== RUN_STATE_FILE_FORMAT) fail(`"format" must be "${RUN_STATE_FILE_FORMAT}"`);
  if (top['fileVersion'] !== RUN_STATE_FILE_VERSION) fail(`unsupported fileVersion`);
  const configHash = top['configHash'];
  if (typeof configHash !== 'string' || !/^[0-9a-f]{16}$/.test(configHash)) {
    fail('"configHash" must be 16 lowercase hex digits');
  }
  const b = record(top['brain'], 'brain');
  const brain: BrainSpec = {
    formatVersion: int(b['formatVersion'], 'brain.formatVersion'),
    inputs: int(b['inputs'], 'brain.inputs'),
    hidden: int(b['hidden'], 'brain.hidden'),
    outputs: int(b['outputs'], 'brain.outputs'),
  };
  const s = record(top['state'], 'state');
  const rngRaw = record(s['rng'], 'state.rng');
  const rng = Object.fromEntries(
    RNG_NAMES.map((name) => [name, rngState(rngRaw[name], `state.rng.${name}`)]),
  ) as unknown as RunRngStates;
  const spawns: TribeSpawn[] = list(s['spawns'], 'state.spawns').map((v, i) => {
    const r = record(v, `state.spawns[${i}]`);
    return {
      tribeId: int(r['tribeId'], `state.spawns[${i}].tribeId`),
      genomes: list(r['genomes'], `state.spawns[${i}].genomes`).map((g, k) =>
        weights(g, `state.spawns[${i}].genomes[${k}]`),
      ),
    };
  });
  const tribes: TribeState[] = list(s['tribes'], 'state.tribes').map((v, i) => {
    const r = record(v, `state.tribes[${i}]`);
    if (typeof r['alive'] !== 'boolean') fail(`state.tribes[${i}].alive must be true or false`);
    const hallOfFame: HallOfFameEntry[] = list(
      r['hallOfFame'],
      `state.tribes[${i}].hallOfFame`,
    ).map((e, k) => {
      const er = record(e, `state.tribes[${i}].hallOfFame[${k}]`);
      return {
        generation: int(er['generation'], 'hall-of-fame generation'),
        benchmarkScore: finite(er['benchmarkScore'], 'hall-of-fame benchmarkScore'),
        genome: weights(er['genome'], `state.tribes[${i}].hallOfFame[${k}].genome`),
      };
    });
    return {
      id: int(r['id'], `state.tribes[${i}].id`),
      size: int(r['size'], `state.tribes[${i}].size`),
      alive: r['alive'],
      hallOfFame,
      history: list(r['history'], `state.tribes[${i}].history`).map((h, k) =>
        stats(h, `state.tribes[${i}].history[${k}]`),
      ),
    };
  });
  if (typeof s['finished'] !== 'boolean') fail('state.finished must be true or false');
  const winner = s['winner'] === null ? null : int(s['winner'], 'state.winner');
  return {
    simVersion: int(top['simVersion'], 'simVersion'),
    configHash,
    brain,
    state: {
      generation: int(s['generation'], 'state.generation'),
      tickCount: int(s['tickCount'], 'state.tickCount'),
      rng,
      spawns,
      tribes,
      finished: s['finished'],
      winner,
    },
  };
}

/**
 * Refuses a run state made by another simulation version, config or brain (plan §3.3), saying
 * why: the simulation would not continue the way it was trained.
 */
export function assertRunStateCompatible(
  file: RunStateFile,
  expected: {
    readonly configHash: string;
    readonly brain: BrainSpec;
    readonly simVersion?: number;
  },
): void {
  const simVersion = expected.simVersion ?? SIM_VERSION;
  if (file.simVersion !== simVersion) {
    throw new RunStateError(
      `the run was saved by simVersion ${file.simVersion}, this build is simVersion ${simVersion}: ` +
        'the rules changed since, so it cannot be continued. Train it again with this build.',
    );
  }
  if (file.configHash !== expected.configHash) {
    throw new RunStateError(
      `the run state was saved under config ${file.configHash}, but run.json's config is ` +
        expected.configHash,
    );
  }
  if (!sameBrainSpec(file.brain, expected.brain)) {
    throw new RunStateError(
      `the run state's brain is ${file.brain.inputs}-${file.brain.hidden}-${file.brain.outputs}, ` +
        `the config's is ${expected.brain.inputs}-${expected.brain.hidden}-${expected.brain.outputs}`,
    );
  }
}
