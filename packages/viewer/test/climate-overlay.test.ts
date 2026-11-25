import type { ClimateStatus } from '@evolution-island/shared';
import { describe, expect, it } from 'vitest';
import { climateAt, climateOverlay, climateSummary } from '../src/renderer/climate-overlay.js';

const CALM: ClimateStatus = { winter: false, events: [], foodZone: null };

describe('climate overlay (Sprint 7.2)', () => {
  it('draws a disc per drought and flood and a ring for the food zone, at tile centres', () => {
    const overlay = climateOverlay({
      winter: true,
      events: [
        { kind: 'flood', x: 3, y: 4, radius: 8, ticksLeft: 10 },
        { kind: 'drought', x: 10, y: 0, radius: 10, ticksLeft: 50 },
      ],
      foodZone: { x: 7, y: 7, radius: 8 },
    });
    expect(overlay.winter).toBe(true);
    expect(overlay.shapes).toEqual([
      { kind: 'flood', x: 3.5, y: 4.5, radius: 8 },
      { kind: 'drought', x: 10.5, y: 0.5, radius: 10 },
      { kind: 'foodZone', x: 7.5, y: 7.5, radius: 8 },
    ]);
  });

  it('has the same key for the same picture (ticks left do not matter), another for a change', () => {
    const flood = (ticksLeft: number): ClimateStatus => ({
      ...CALM,
      events: [{ kind: 'flood', x: 1, y: 1, radius: 8, ticksLeft }],
    });
    expect(climateOverlay(flood(10)).key).toBe(climateOverlay(flood(9)).key);
    expect(climateOverlay(flood(10)).key).not.toBe(climateOverlay(CALM).key);
    expect(climateOverlay({ ...CALM, winter: true }).key).not.toBe(climateOverlay(CALM).key);
  });

  it('summarises the climate for the HUD', () => {
    expect(climateSummary(CALM)).toBe('');
    expect(
      climateSummary({
        winter: true,
        events: [
          { kind: 'flood', x: 0, y: 0, radius: 1, ticksLeft: 1 },
          { kind: 'drought', x: 0, y: 0, radius: 1, ticksLeft: 1 },
          { kind: 'drought', x: 5, y: 0, radius: 1, ticksLeft: 1 },
        ],
        foodZone: null,
      }),
    ).toBe('Winter · 1 flood · 2 droughts');
  });

  it('names the events covering a tile for the hover line, newest first', () => {
    const status: ClimateStatus = {
      winter: false,
      events: [
        { kind: 'flood', x: 10, y: 10, radius: 3, ticksLeft: 5 },
        { kind: 'drought', x: 12, y: 10, radius: 2, ticksLeft: 5 },
      ],
      foodZone: { x: 0, y: 0, radius: 2 },
    };
    expect(climateAt(status, 12, 10)).toEqual(['drought', 'flood']);
    expect(climateAt(status, 7, 10)).toEqual(['flood']);
    expect(climateAt(status, 1, 1)).toEqual(['food zone']);
    expect(climateAt(status, 30, 30)).toEqual([]);
  });
});
