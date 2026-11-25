// Runs in Node (`pnpm test`) and in Chromium, Firefox and WebKit (`pnpm test:browser`): keep it
// free of Node APIs. Plan §4 Sprint 5.2: same replay → same final state hash in every engine.
import { createEvolutionRun, SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  parseReplay,
  playReplay,
  recordReplay,
  serializeReplay,
  type ReplayEvent,
} from '../src/index.js';

/**
 * The pinned replay: Small seed 42, default config (memory and climate on), from generation 1,
 * 1,500 ticks, a hash every 300, with spectator events (Sprint 7.2: plan §4 "a replay containing
 * spectator events reproduces the same state hash"). Re-recorded only with a SIM_VERSION bump.
 */
const PINNED = {
  simVersion: 14,
  finalHash: '960d4c1ede410aa6',
} as const;

const EVENTS: readonly ReplayEvent[] = [
  { tick: 10, kind: 'flood', x: 20, y: 30 },
  { tick: 10, kind: 'foodZone', x: 40, y: 20 },
  { tick: 250, kind: 'drought', x: 32, y: 32 },
  { tick: 600, kind: 'winter', x: 0, y: 0 },
];

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
      events: EVENTS,
    });
    expect(recorded.events).toEqual(EVENTS);
    expect(recorded.hashes.at(-1)!.hash).toBe(PINNED.finalHash);
    const parsed = parseReplay(serializeReplay(recorded));
    expect(parsed.events).toEqual(EVENTS);
    const played = playReplay(parsed);
    expect(played.mismatch).toBeNull();
    expect(played.matched).toBe(5);
    expect(played.finalHash).toBe(PINNED.finalHash);
  });
});
