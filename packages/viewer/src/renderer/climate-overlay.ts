import type { ClimateStatus } from '@evolution-island/shared';

/**
 * What the climate overlay draws (Sprint 7.2), in tiles: a disc per drought (amber) and flood
 * (blue), a ring for the food zone (green), and a frost wash over the whole map in winter. Kept
 * pure so tests can check it without WebGL; `MapView` turns it into Pixi graphics.
 */
export interface ClimateShape {
  readonly kind: 'drought' | 'flood' | 'foodZone';
  /** Centre of the tile, in tiles. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface ClimateOverlay {
  readonly winter: boolean;
  readonly shapes: readonly ClimateShape[];
  /** Equal keys draw the same picture (so a redraw can be skipped). */
  readonly key: string;
}

export const CLIMATE_COLORS = {
  drought: 0xd97706,
  flood: 0x38bdf8,
  foodZone: 0x4ade80,
  winter: 0xe0f2fe,
} as const;

export function climateOverlay(status: ClimateStatus): ClimateOverlay {
  const shapes: ClimateShape[] = status.events.map((e) => ({
    kind: e.kind,
    x: e.x + 0.5,
    y: e.y + 0.5,
    radius: e.radius,
  }));
  const zone = status.foodZone;
  if (zone !== null) {
    shapes.push({ kind: 'foodZone', x: zone.x + 0.5, y: zone.y + 0.5, radius: zone.radius });
  }
  const key =
    (status.winter ? 'W|' : 'S|') +
    shapes.map((s) => `${s.kind}:${s.x},${s.y},${s.radius}`).join('|');
  return { winter: status.winter, shapes, key };
}

/** A one-line summary for the HUD, e.g. "Winter · 1 flood · 2 droughts", or "" when calm. */
export function climateSummary(status: ClimateStatus): string {
  const parts: string[] = [];
  if (status.winter) parts.push('Winter');
  const count = (kind: 'drought' | 'flood'): number =>
    status.events.filter((e) => e.kind === kind).length;
  const floods = count('flood');
  const droughts = count('drought');
  if (floods > 0) parts.push(`${floods} flood${floods === 1 ? '' : 's'}`);
  if (droughts > 0) parts.push(`${droughts} drought${droughts === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The climate events covering tile (x, y), newest first ("flood", "drought", "food zone"), for the
 * hover line: the terrain textures show the map as generated, the overlay shows the changes.
 */
export function climateAt(status: ClimateStatus, x: number, y: number): string[] {
  const inside = (cx: number, cy: number, r: number): boolean =>
    (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  const names = status.events
    .filter((e) => inside(e.x, e.y, e.radius))
    .map((e) => e.kind as string)
    .reverse();
  const zone = status.foodZone;
  if (zone !== null && inside(zone.x, zone.y, zone.radius)) names.push('food zone');
  return names;
}
