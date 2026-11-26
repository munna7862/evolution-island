import { SIM_VERSION, type MapPresetId, type Seed } from '@evolution-island/sim-core';

/**
 * Featured runs (plan §4 Phase 10): pre-trained runs published with the static viewer. The
 * trainer copies a few checkpoints of each chosen run next to the site (`pnpm featured`) and
 * writes this manifest; the viewer lists the runs and fetches their files on demand.
 */
export const FEATURED_RUNS_FORMAT = 'evolution-island/featured-runs';
export const FEATURED_RUNS_FILE_VERSION = 1;
/** Manifest file name inside the published runs folder. */
export const FEATURED_RUNS_FILE = 'index.json';

export interface FeaturedRun {
  /** Folder name under the runs folder, and the `?run=` link value. */
  readonly name: string;
  /** For the menu, e.g. "Medium · seed 42 · 300 generations". */
  readonly title: string;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  /** Saved generations published, ascending. */
  readonly generations: readonly number[];
  /** Every file of the run, relative to its folder (`/`-separated). */
  readonly files: readonly string[];
}

export interface FeaturedRunsManifest {
  readonly simVersion: number;
  readonly configHash: string;
  readonly runs: readonly FeaturedRun[];
}

export class FeaturedRunsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeaturedRunsError';
  }
}

function fail(why: string): never {
  throw new FeaturedRunsError(`Invalid featured runs manifest: ${why}`);
}

export function serializeFeaturedRuns(manifest: FeaturedRunsManifest): string {
  return `${JSON.stringify(
    {
      format: FEATURED_RUNS_FORMAT,
      fileVersion: FEATURED_RUNS_FILE_VERSION,
      simVersion: manifest.simVersion,
      configHash: manifest.configHash,
      runs: manifest.runs,
    },
    null,
    2,
  )}\n`;
}

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
/** A safe relative path: no `..`, no leading `/`, no backslashes. */
const FILE = /^(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function parseFeaturedRuns(text: string): FeaturedRunsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) fail('top level must be an object');
  const r = parsed as Record<string, unknown>;
  if (r['format'] !== FEATURED_RUNS_FORMAT) fail(`"format" must be "${FEATURED_RUNS_FORMAT}"`);
  if (r['fileVersion'] !== FEATURED_RUNS_FILE_VERSION) fail('unsupported fileVersion');
  const simVersion = r['simVersion'];
  const configHash = r['configHash'];
  if (typeof simVersion !== 'number' || !Number.isSafeInteger(simVersion)) {
    fail('"simVersion" must be an integer');
  }
  if (typeof configHash !== 'string' || !/^[0-9a-f]{16}$/.test(configHash)) {
    fail('"configHash" must be 16 lowercase hex digits');
  }
  const runs = r['runs'];
  if (!Array.isArray(runs)) fail('"runs" must be an array');
  const names = new Set<string>();
  const parsedRuns = runs.map((raw: unknown, i): FeaturedRun => {
    const run = raw as Record<string, unknown> | null;
    const name = run?.['name'];
    if (typeof name !== 'string' || !NAME.test(name)) fail(`runs[${i}].name is not a folder name`);
    if (names.has(name)) fail(`run "${name}" appears twice`);
    names.add(name);
    const title = run?.['title'];
    const preset = run?.['preset'];
    const seed = run?.['seed'];
    const generations = run?.['generations'];
    const files = run?.['files'];
    if (typeof title !== 'string') fail(`runs[${i}].title must be text`);
    if (typeof preset !== 'string') fail(`runs[${i}].preset must be text`);
    if (typeof seed !== 'number' && typeof seed !== 'string') fail(`runs[${i}].seed`);
    if (!Array.isArray(generations) || !generations.every((g) => Number.isSafeInteger(g))) {
      fail(`runs[${i}].generations must be integers`);
    }
    if (!Array.isArray(files) || !files.every((f) => typeof f === 'string' && FILE.test(f))) {
      fail(`runs[${i}].files must be relative paths inside the run folder`);
    }
    return {
      name,
      title,
      preset: preset as MapPresetId,
      seed,
      generations: generations as number[],
      files: files as string[],
    };
  });
  return { simVersion, configHash, runs: parsedRuns };
}

/** Whether a manifest's runs can be played by this build (same rules and default config). */
export function featuredRunsPlayable(
  manifest: FeaturedRunsManifest,
  expected: { readonly configHash: string; readonly simVersion?: number },
): boolean {
  return (
    manifest.simVersion === (expected.simVersion ?? SIM_VERSION) &&
    manifest.configHash === expected.configHash
  );
}

/**
 * Which saved generations of a run to publish: the first, the last, and the ones nearest a
 * quarter, half and three quarters of the way (ties → the earlier one) — enough to watch a run
 * learn without shipping
 * every checkpoint. `available` in any order; the result ascends without duplicates.
 */
export function pickFeaturedGenerations(available: readonly number[]): number[] {
  const sorted = [...new Set(available)].sort((a, b) => a - b);
  if (sorted.length <= 5) return sorted;
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const nearest = (target: number): number =>
    sorted.reduce((best, g) => (Math.abs(g - target) < Math.abs(best - target) ? g : best));
  const picks = [first, ...[0.25, 0.5, 0.75].map((f) => nearest(first + (last - first) * f)), last];
  return [...new Set(picks)].sort((a, b) => a - b);
}
