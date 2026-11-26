import { MAP_PRESETS, SIM_VERSION, type MapPresetId, type Seed } from '@evolution-island/sim-core';
import { parseSeed } from '@evolution-island/shared';

/**
 * Shareable links (plan §4 Phase 10): `?preset=large&seed=1234&v=<simVersion>` (and
 * `&run=<name>&gen=<generation>` for a featured run's saved generation). The same preset and seed generate the same map on any machine of the same
 * simVersion; `v` lets the viewer say when a link was made by other rules.
 */
export interface ShareParams {
  readonly preset: MapPresetId | null;
  readonly seed: Seed | null;
  /** simVersion the link was made with, if it says. */
  readonly simVersion: number | null;
  /** Featured run to play, and which of its saved generations (null: the latest). */
  readonly run: string | null;
  readonly generation: number | null;
}

function isPreset(value: string | null): value is MapPresetId {
  return value !== null && Object.prototype.hasOwnProperty.call(MAP_PRESETS, value);
}

export function readShareParams(search: string): ShareParams {
  const params = new URLSearchParams(search);
  const rawSeed = params.get('seed');
  const rawVersion = params.get('v');
  const version = rawVersion === null ? Number.NaN : Number(rawVersion);
  const run = params.get('run');
  const generation = Number(params.get('gen') ?? Number.NaN);
  return {
    preset: isPreset(params.get('preset')) ? (params.get('preset') as MapPresetId) : null,
    seed: rawSeed === null || rawSeed.trim() === '' ? null : parseSeed(rawSeed, 42),
    simVersion: Number.isSafeInteger(version) ? version : null,
    run: run !== null && /^[a-z0-9][a-z0-9._-]*$/.test(run) ? run : null,
    generation: Number.isSafeInteger(generation) && generation >= 1 ? generation : null,
  };
}

/**
 * `url` with the share parameters set: preset, seed and this build's simVersion, plus `run` and
 * `gen` when a featured run plays (removed otherwise). Other parameters (e.g. `speed`) are kept.
 */
export function shareUrl(
  url: string,
  state: {
    readonly preset: MapPresetId;
    readonly seed: Seed;
    readonly run: string | null;
    readonly generation?: number | null;
  },
): string {
  const next = new URL(url);
  next.searchParams.set('preset', state.preset);
  next.searchParams.set('seed', String(state.seed));
  next.searchParams.set('v', String(SIM_VERSION));
  if (state.run === null) next.searchParams.delete('run');
  else next.searchParams.set('run', state.run);
  const generation = state.run === null ? null : (state.generation ?? null);
  if (generation === null) next.searchParams.delete('gen');
  else next.searchParams.set('gen', String(generation));
  return next.toString();
}

/** A warning for a link made by other rules, or null if it matches this build (or doesn't say). */
export function versionNotice(linkVersion: number | null): string | null {
  if (linkVersion === null || linkVersion === SIM_VERSION) return null;
  return (
    `This link was made with simulation v${linkVersion}; this site runs v${SIM_VERSION}, so the ` +
    'same seed may make a different map and world.'
  );
}
