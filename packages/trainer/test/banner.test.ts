import { SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { banner } from '../src/index.js';

describe('trainer banner', () => {
  it('names the app and the sim version', () => {
    expect(banner()).toBe(`Evolution Island trainer (sim v${SIM_VERSION})`);
  });
});
