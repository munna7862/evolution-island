#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_REPLAY_HASH_EVERY,
  parseConfigOverride,
  parseReplay,
  parseRunManifest,
  parseRunState,
  playReplay,
  recordReplay,
  RUN_MANIFEST_NAME,
  RUN_STATE_FILE_NAME,
  applyConfigOverride,
  parseSeed,
  serializeReplay,
} from '@evolution-island/shared';
import {
  createEvolutionRun,
  DEFAULT_CONFIG,
  MAP_PRESETS,
  type MapPresetId,
} from '@evolution-island/sim-core';

const USAGE = `Usage:
  pnpm replay export --run <run folder> --ticks <n> --out <file> [--hash-every <k>]
  pnpm replay export --preset <id> --seed <seed> [--config <file>] --ticks <n> --out <file>
  pnpm replay verify <file>

export  records a replay: from the run's resume.json (where its training stopped), or from a
        fresh generation 1; a run.hash() every --hash-every ticks (default ${DEFAULT_REPLAY_HASH_EVERY}) and at the end
verify  plays a replay in Node and checks every recorded hash (exit 1 at the first mismatch)`;

function positive(flag: string, raw: string | undefined, fallback?: number): number {
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${flag} is required`);
  }
  const n = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got "${raw}"`);
  }
  return n;
}

function exportReplay(argv: readonly string[]): void {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      run: { type: 'string' },
      preset: { type: 'string' },
      seed: { type: 'string' },
      config: { type: 'string' },
      ticks: { type: 'string' },
      'hash-every': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const ticks = positive('--ticks', values.ticks);
  const hashEvery = positive('--hash-every', values['hash-every'], DEFAULT_REPLAY_HASH_EVERY);
  if (values.out === undefined) throw new Error('--out is required');
  let replay;
  if (values.run !== undefined) {
    if (values.preset !== undefined || values.seed !== undefined || values.config !== undefined) {
      throw new Error('--run takes preset, seed and config from the run; drop the others');
    }
    const text = readFileSync(join(values.run, RUN_MANIFEST_NAME), 'utf8');
    const manifest = parseRunManifest(text);
    const config = applyConfigOverride((JSON.parse(text) as { config?: unknown }).config);
    const state = parseRunState(readFileSync(join(values.run, RUN_STATE_FILE_NAME), 'utf8')).state;
    replay = recordReplay({
      preset: manifest.preset,
      seed: manifest.seed,
      config,
      start: state,
      ticks,
      hashEvery,
    });
  } else {
    const preset = values.preset ?? 'small';
    if (!Object.prototype.hasOwnProperty.call(MAP_PRESETS, preset)) {
      throw new Error(`--preset must be one of ${Object.keys(MAP_PRESETS).join(', ')}`);
    }
    const seed = parseSeed(values.seed ?? '42');
    const config =
      values.config === undefined
        ? DEFAULT_CONFIG
        : parseConfigOverride(readFileSync(values.config, 'utf8'));
    const start = createEvolutionRun({
      preset: preset as MapPresetId,
      seed,
      config,
    }).captureState();
    replay = recordReplay({ preset: preset as MapPresetId, seed, config, start, ticks, hashEvery });
  }
  writeFileSync(values.out, serializeReplay(replay));
  console.log(
    `Replay of ${replay.preset}-${String(replay.seed)} from generation ${replay.start.generation}: ` +
      `${ticks} ticks, ${replay.hashes.length} hashes, final ${replay.hashes.at(-1)!.hash} → ${values.out}`,
  );
}

function verifyReplay(argv: readonly string[]): number {
  const [file] = argv;
  if (file === undefined) throw new Error('verify needs a replay file');
  const replay = parseReplay(readFileSync(file, 'utf8'));
  const result = playReplay(replay);
  if (result.mismatch !== null) {
    const m = result.mismatch;
    console.error(`Diverged at tick ${m.tick}: expected ${m.expected}, got ${m.actual}`);
    return 1;
  }
  console.log(
    `OK: ${replay.ticks} ticks, ${result.matched} of ${replay.hashes.length} hashes match, final ${result.finalHash}`,
  );
  return 0;
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  try {
    if (command === 'export') {
      exportReplay(rest);
      return 0;
    }
    if (command === 'verify') return verifyReplay(rest);
    console.log(USAGE);
    return command === undefined || command === '--help' ? 0 : 2;
  } catch (error: unknown) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
