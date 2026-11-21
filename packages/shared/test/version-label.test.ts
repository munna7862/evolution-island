import { SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { simVersionLabel } from '../src/index.js';

describe('simVersionLabel', () => {
  it('shows the sim-core version', () => {
    expect(simVersionLabel()).toBe(`sim v${SIM_VERSION}`);
  });
});
