import {
  createEvolutionRun,
  hashConfig,
  SIM_VERSION,
  type EvolutionRun,
  type EvolutionRunState,
  type MapPresetId,
  type Seed,
  type SimConfig,
  type WorldEvent,
  WORLD_EVENT_KINDS,
} from '@evolution-island/sim-core';
import { applyConfigOverride } from './config-override.js';
import { runStateFromJson, runStateToJson } from './run-state.js';

/**
 * Replay files (plan §4 Sprint 5.2): one shareable file that re-runs a world bit for bit — the
 * full config, the map (preset + seed), the start (a run state: every creature's genome, the RNG
 * streams, the tribes), the spectator events with their ticks, and `run.hash()` every `hashEvery`
 * ticks and at the end, so a divergence is found at the first checkpoint that differs.
 */
export const REPLAY_FILE_FORMAT = 'evolution-island/replay';
export const REPLAY_FILE_VERSION = 1;
/** Default distance between recorded hashes. */
export const DEFAULT_REPLAY_HASH_EVERY = 500;

/**
 * Spectator input applied between ticks (plan §3.3, Sprint 7.2): a world event (drought, flood,
 * winter, food zone) applied after `tick` ticks have been played, before the next one. Events
 * with the same tick apply in file order.
 */
export interface ReplayEvent extends WorldEvent {
  readonly tick: number;
}

/**
 * Applies `events[from..]` due after `played` ticks to the run's world; returns the index of the
 * first event not applied yet. `events` must be sorted by tick.
 */
export function applyDueEvents(
  run: EvolutionRun,
  events: readonly ReplayEvent[],
  from: number,
  played: number,
): number {
  let next = from;
  while (next < events.length && events[next]!.tick === played) {
    const e = events[next]!;
    run.world.applyWorldEvent({ kind: e.kind, x: e.x, y: e.y });
    next++;
  }
  return next;
}

export interface ReplayHash {
  /** Ticks played since the start. */
  readonly tick: number;
  /** `run.hash()` after that many ticks. */
  readonly hash: string;
}

export interface Replay {
  readonly simVersion: number;
  readonly configHash: string;
  readonly config: SimConfig;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly start: EvolutionRunState;
  /** Ticks the replay plays. */
  readonly ticks: number;
  readonly hashEvery: number;
  readonly hashes: readonly ReplayHash[];
  readonly events: readonly ReplayEvent[];
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

function fail(message: string): never {
  throw new ReplayError(`Invalid replay file: ${message}`);
}

/** Whether a hash is due after `tick` ticks (every `hashEvery`, and at the end). */
export function isReplayHashTick(tick: number, hashEvery: number, ticks: number): boolean {
  return tick === ticks || (hashEvery > 0 && tick % hashEvery === 0);
}

/** The run a replay starts from. */
export function startReplayRun(
  replay: Pick<Replay, 'preset' | 'seed' | 'config' | 'start'>,
): EvolutionRun {
  return createEvolutionRun({
    preset: replay.preset,
    seed: replay.seed,
    config: replay.config,
    resume: replay.start,
  });
}

export interface RecordOptions {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly config: SimConfig;
  /** Where to start: `run.captureState()` of a run between generations. */
  readonly start: EvolutionRunState;
  readonly ticks: number;
  readonly hashEvery?: number;
  /** Spectator events to apply (sorted by tick, each in 0..ticks − 1). */
  readonly events?: readonly ReplayEvent[];
}

/** Plays `ticks` ticks from the start (in Node or a worker) and records the hashes. */
export function recordReplay(options: RecordOptions): Replay {
  const hashEvery = options.hashEvery ?? DEFAULT_REPLAY_HASH_EVERY;
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 1) {
    throw new RangeError(`ticks must be a positive integer, got ${options.ticks}`);
  }
  if (!Number.isSafeInteger(hashEvery) || hashEvery < 1) {
    throw new RangeError(`hashEvery must be a positive integer, got ${hashEvery}`);
  }
  const events = options.events ?? [];
  checkEvents(events, options.ticks, (message) => {
    throw new RangeError(message);
  });
  const run = startReplayRun(options);
  const hashes: ReplayHash[] = [];
  let nextEvent = 0;
  for (let tick = 1; tick <= options.ticks; tick++) {
    nextEvent = applyDueEvents(run, events, nextEvent, tick - 1);
    run.tick();
    if (isReplayHashTick(tick, hashEvery, options.ticks)) hashes.push({ tick, hash: run.hash() });
  }
  return {
    simVersion: SIM_VERSION,
    configHash: hashConfig(options.config),
    config: options.config,
    preset: options.preset,
    seed: options.seed,
    start: options.start,
    ticks: options.ticks,
    hashEvery,
    hashes,
    events: events.map((e) => ({ ...e })),
  };
}

/** Events must be sorted by tick, each within 0..ticks − 1 (`report` throws). */
function checkEvents(
  events: readonly ReplayEvent[],
  ticks: number,
  report: (message: string) => never,
): void {
  events.forEach((e, i) => {
    if (!Number.isSafeInteger(e.tick) || e.tick < 0 || e.tick >= ticks) {
      report(`events[${i}].tick must be within 0..ticks − 1`);
    }
    if (i > 0 && e.tick < events[i - 1]!.tick) report('events must be sorted by tick');
  });
}

export interface ReplayMismatch {
  readonly tick: number;
  readonly expected: string;
  readonly actual: string;
}

export interface ReplayResult {
  /** `run.hash()` after the last tick. */
  readonly finalHash: string;
  /** Recorded hashes that matched before the first mismatch (all of them if none). */
  readonly matched: number;
  /** The first recorded hash that differs, or null. */
  readonly mismatch: ReplayMismatch | null;
}

/** Re-runs a replay and checks every recorded hash; stops at the first mismatch. */
export function playReplay(replay: Replay): ReplayResult {
  const run = startReplayRun(replay);
  const expected = new Map(replay.hashes.map((h) => [h.tick, h.hash]));
  let matched = 0;
  let nextEvent = 0;
  for (let tick = 1; tick <= replay.ticks; tick++) {
    nextEvent = applyDueEvents(run, replay.events, nextEvent, tick - 1);
    run.tick();
    const want = expected.get(tick);
    if (want === undefined) continue;
    const actual = run.hash();
    if (actual !== want)
      return { finalHash: actual, matched, mismatch: { tick, expected: want, actual } };
    matched++;
  }
  return { finalHash: run.hash(), matched, mismatch: null };
}

export function serializeReplay(replay: Replay): string {
  return JSON.stringify({
    format: REPLAY_FILE_FORMAT,
    fileVersion: REPLAY_FILE_VERSION,
    simVersion: replay.simVersion,
    configHash: replay.configHash,
    preset: replay.preset,
    seed: replay.seed,
    ticks: replay.ticks,
    hashEvery: replay.hashEvery,
    hashes: replay.hashes,
    events: replay.events,
    config: replay.config,
    start: runStateToJson(replay.start),
  });
}

function int(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    fail(`"${what}" must be an integer`);
  return value;
}

/**
 * Parses a replay file and checks it can run here: refuses another `simVersion` (the rules
 * changed, it would not re-run the same), a config that doesn't match its hash, and events of an
 * unknown kind, out of order or outside the replay's ticks.
 */
export function parseReplay(text: string): Replay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    fail('top level must be an object');
  const r = parsed as Record<string, unknown>;
  if (r['format'] !== REPLAY_FILE_FORMAT) fail(`"format" must be "${REPLAY_FILE_FORMAT}"`);
  if (r['fileVersion'] !== REPLAY_FILE_VERSION) fail('unsupported fileVersion');
  const simVersion = int(r['simVersion'], 'simVersion');
  if (simVersion !== SIM_VERSION) {
    throw new ReplayError(
      `the replay was made by simVersion ${simVersion}, this build is simVersion ${SIM_VERSION}: ` +
        'the rules changed since, so it would not play the same.',
    );
  }
  let config: SimConfig;
  try {
    config = applyConfigOverride(r['config']);
  } catch (error: unknown) {
    fail(`config: ${error instanceof Error ? error.message : String(error)}`);
  }
  const configHash = r['configHash'];
  if (typeof configHash !== 'string' || hashConfig(config) !== configHash) {
    fail('"configHash" does not match its config');
  }
  const preset = r['preset'];
  if (typeof preset !== 'string' || !Object.prototype.hasOwnProperty.call(config.presets, preset)) {
    fail('"preset" must be a preset id');
  }
  const seed = r['seed'];
  if (typeof seed !== 'number' && typeof seed !== 'string') fail('"seed" must be a number or text');
  const ticks = int(r['ticks'], 'ticks');
  const hashEvery = int(r['hashEvery'], 'hashEvery');
  if (ticks < 1 || hashEvery < 1) fail('"ticks" and "hashEvery" must be ≥ 1');
  const rawHashes = r['hashes'];
  if (!Array.isArray(rawHashes)) fail('"hashes" must be an array');
  const hashes = rawHashes.map((h: unknown, i): ReplayHash => {
    const hr = h as Record<string, unknown> | null;
    const tick = int(hr?.['tick'], `hashes[${i}].tick`);
    const hash = hr?.['hash'];
    if (typeof hash !== 'string' || !/^[0-9a-f]{16}$/.test(hash))
      fail(`hashes[${i}].hash must be a 16-digit hash`);
    if (tick < 1 || tick > ticks) fail(`hashes[${i}].tick is outside 1..ticks`);
    return { tick, hash };
  });
  const rawEvents = r['events'];
  if (!Array.isArray(rawEvents)) fail('"events" must be an array');
  const events = rawEvents.map((raw: unknown, i): ReplayEvent => {
    const e = raw as Record<string, unknown> | null;
    const kind = e?.['kind'];
    if (typeof kind !== 'string' || !(WORLD_EVENT_KINDS as readonly string[]).includes(kind)) {
      fail(`events[${i}].kind must be one of ${WORLD_EVENT_KINDS.join(', ')}`);
    }
    return {
      tick: int(e?.['tick'], `events[${i}].tick`),
      kind: kind as ReplayEvent['kind'],
      x: int(e?.['x'], `events[${i}].x`),
      y: int(e?.['y'], `events[${i}].y`),
    };
  });
  checkEvents(events, ticks, fail);
  return {
    simVersion,
    configHash,
    config,
    preset: preset as MapPresetId,
    seed,
    start: runStateFromJson(r['start']),
    ticks,
    hashEvery,
    hashes,
    events,
  };
}
