import { MAP_PRESETS } from '@evolution-island/sim-core';
import type { SeedJob, SeedProgress, SeedSummary } from './train-seed.js';

/** Worker → main thread. */
export type SeedWorkerMessage =
  | { readonly type: 'progress'; readonly progress: SeedProgress }
  | { readonly type: 'done'; readonly summary: SeedSummary };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `workerData` arrives untyped; check the fields `trainSeed` relies on. */
export function assertSeedJob(value: unknown): SeedJob {
  if (
    !isRecord(value) ||
    typeof value['preset'] !== 'string' ||
    !Object.prototype.hasOwnProperty.call(MAP_PRESETS, value['preset']) ||
    !(typeof value['seed'] === 'number' || typeof value['seed'] === 'string') ||
    typeof value['generations'] !== 'number' ||
    typeof value['saveEvery'] !== 'number' ||
    typeof value['outDir'] !== 'string' ||
    typeof value['force'] !== 'boolean' ||
    !(value['config'] === undefined || isRecord(value['config']))
  ) {
    throw new TypeError('seed worker received an invalid job');
  }
  return value as unknown as SeedJob;
}

export function isSeedWorkerMessage(value: unknown): value is SeedWorkerMessage {
  return (
    isRecord(value) &&
    ((value['type'] === 'progress' && isRecord(value['progress'])) ||
      (value['type'] === 'done' && isRecord(value['summary'])))
  );
}
