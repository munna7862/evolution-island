import { SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { statusLine } from '../src/status.js';

describe('viewer status line', () => {
  it('shows the sim version', () => {
    expect(statusLine()).toContain(`sim v${SIM_VERSION}`);
  });
});
