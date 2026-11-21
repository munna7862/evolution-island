import { describe, expect, it } from 'vitest';
import { createWorld, SIM_VERSION } from '../src/index.js';
import { GOLDEN } from './golden-hashes.js';

describe('golden state hashes (see golden-hashes.ts before changing anything here)', () => {
  it('are recorded for the current SIM_VERSION', () => {
    expect(GOLDEN.simVersion).toBe(SIM_VERSION);
  });

  it('reproduce the pinned map and world hashes', () => {
    const world = createWorld({ preset: GOLDEN.preset, seed: GOLDEN.seed });
    expect(world.map.hash).toBe(GOLDEN.mapHash);

    const ticks = Object.keys(GOLDEN.worldHashes)
      .map(Number)
      .sort((a, b) => a - b);
    const actual: Record<number, string> = {};
    for (const target of ticks) {
      while (world.tickCount < target) world.tick();
      actual[target] = world.hash();
    }
    expect(actual).toEqual(GOLDEN.worldHashes);
  });
});
