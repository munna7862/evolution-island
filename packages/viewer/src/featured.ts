import {
  FEATURED_RUNS_FILE,
  parseFeaturedRuns,
  type FeaturedRun,
  type FeaturedRunsManifest,
} from '@evolution-island/shared';
import type { RunFileSource } from './run-loader.js';

/**
 * Featured runs published with the static site (plan §4 Phase 10): the manifest and the run
 * files are fetched from `runs/` next to the page, the files only when a checkpoint is played.
 */
export type FetchText = (url: string) => Promise<string>;

/** `runs/` next to the page (works under a sub-path such as GitHub Pages' `/<repo>/`). */
export function featuredBaseUrl(documentUrl: string): string {
  return new URL('runs/', documentUrl).toString();
}

/** The manifest, or null when the site has none (404 or unreadable). */
export async function fetchFeaturedRuns(
  baseUrl: string,
  fetchText: FetchText,
): Promise<FeaturedRunsManifest | null> {
  try {
    return parseFeaturedRuns(await fetchText(new URL(FEATURED_RUNS_FILE, baseUrl).toString()));
  } catch {
    return null;
  }
}

/** One featured run's files as run sources (paths relative to the run, fetched on demand). */
export function featuredSources(
  run: FeaturedRun,
  baseUrl: string,
  fetchText: FetchText,
): RunFileSource[] {
  const runUrl = new URL(`${run.name}/`, baseUrl);
  return run.files.map((file) => ({
    path: file,
    text: () => fetchText(new URL(file, runUrl).toString()),
  }));
}

/** `fetch` as `FetchText`: rejects on HTTP errors. */
export const fetchTextOrThrow: FetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
};
