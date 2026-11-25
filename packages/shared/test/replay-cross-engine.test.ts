// Runs in Node (`pnpm test`) and in Chromium, Firefox and WebKit (`pnpm test:browser`): keep it
// free of Node APIs. Plan §4 Sprint 5.2: same replay → same final state hash in every engine.
import { createEvolutionRun, SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { parseReplay, playReplay, recordReplay, serializeReplay } from '../src/index.js';

/**
 * The pinned replay: Small seed 42, default config (memory on), from generation 1, 1,500 ticks,
 * a hash every 300. Re-recorded only with a SIM_VERSION bump (like golden-hashes.ts).
 */
const PINNED = {
  simVersion: 13,
  finalHash: 'c2e53ca6fa320079',
} as const;

describe('replay determinism across engines (Sprint 5.2)', () => {
  it('records, serializes, parses and plays to the pinned final hash', () => {
    expect(PINNED.simVersion).toBe(SIM_VERSION);
    const run = createEvolutionRun({ preset: 'small', seed: 42 });
    const recorded = recordReplay({
      preset: 'small',
      seed: 42,
      config: run.config,
      start: run.captureState(),
      ticks: 1500,
      hashEvery: 300,
    });
    expect(recorded.hashes.at(-1)!.hash).toBe(PINNED.finalHash);
    const played = playReplay(parseReplay(serializeReplay(recorded)));
    expect(played.mismatch).toBeNull();
    expect(played.matched).toBe(5);
    expect(played.finalHash).toBe(PINNED.finalHash);
  });
});
