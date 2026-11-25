import {
  CHECKPOINT_FILE_NAME,
  checkpointStart,
  parseCheckpoint,
  parseGenome,
  type CheckpointExpectations,
  type CheckpointFile,
  type LoadedGenome,
} from '@evolution-island/shared';
import type { EvolutionStart } from '@evolution-island/sim-core';

/**
 * Finding and loading checkpoints among files the user picked or dropped (plan §4 Sprint 3.3).
 * Works on paths, so a whole run folder, a folder of runs, one `gen-NNNN` folder or its loose
 * files all load the same way: a checkpoint's genome files are the files next to it.
 */
export interface RunFileSource {
  /** Path relative to what was picked/dropped, `/`-separated (a bare name for loose files). */
  readonly path: string;
  text(): Promise<string>;
}

export interface FoundCheckpoint {
  /** For the generation menu, e.g. `Gen 100 · medium-42`. */
  readonly label: string;
  /** Folder of `checkpoint.json` ('' for loose files), with a trailing `/`. */
  readonly dir: string;
  readonly checkpoint: CheckpointFile;
}

export interface RunScan {
  /** By run (preset-seed), then generation. */
  readonly checkpoints: readonly FoundCheckpoint[];
  /** Checkpoint files that could not be read, as messages. */
  readonly problems: readonly string[];
}

/** Backslashes → `/`, no leading `/` or `./`. */
export function normalizeRunPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(\.\/|\/)+/, '');
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}

function isCheckpointPath(path: string): boolean {
  return path === CHECKPOINT_FILE_NAME || path.endsWith(`/${CHECKPOINT_FILE_NAME}`);
}

export function runName(checkpoint: CheckpointFile): string {
  return `${checkpoint.preset}-${String(checkpoint.seed)}`;
}

/** Reads every `checkpoint.json` among `sources` (genome files are left for `loadCheckpoint`). */
export async function scanRunFiles(sources: readonly RunFileSource[]): Promise<RunScan> {
  const found: FoundCheckpoint[] = [];
  const problems: string[] = [];
  for (const source of sources) {
    const path = normalizeRunPath(source.path);
    if (!isCheckpointPath(path)) continue;
    try {
      const checkpoint = parseCheckpoint(await source.text());
      found.push({
        label: `Gen ${checkpoint.generation} · ${runName(checkpoint)}`,
        dir: dirOf(path),
        checkpoint,
      });
    } catch (error: unknown) {
      problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  found.sort((a, b) => {
    const byRun = runName(a.checkpoint).localeCompare(runName(b.checkpoint));
    if (byRun !== 0) return byRun;
    if (a.checkpoint.generation !== b.checkpoint.generation) {
      return a.checkpoint.generation - b.checkpoint.generation;
    }
    return a.dir.localeCompare(b.dir);
  });
  return { checkpoints: found, problems };
}

/** The latest generation of the first run: what the viewer plays right after loading. */
export function defaultCheckpoint(scan: RunScan): FoundCheckpoint | null {
  const first = scan.checkpoints[0];
  if (first === undefined) return null;
  const sameRun = scan.checkpoints.filter(
    (c) => runName(c.checkpoint) === runName(first.checkpoint),
  );
  return sameRun[sameRun.length - 1] ?? null;
}

/**
 * Reads the chosen checkpoint's genome files and builds the `EvolutionRun` start that plays it.
 * Throws (with a message for the user) on missing or incompatible files.
 */
export async function loadCheckpoint(
  found: FoundCheckpoint,
  sources: readonly RunFileSource[],
  expected: CheckpointExpectations,
): Promise<EvolutionStart> {
  const byPath = new Map(sources.map((s) => [normalizeRunPath(s.path), s]));
  const genomes = new Map<string, LoadedGenome>();
  for (const tribe of found.checkpoint.tribes) {
    for (const entry of tribe.hallOfFame) {
      const source = byPath.get(found.dir + entry.file);
      if (source === undefined) continue; // checkpointStart reports it as missing
      genomes.set(entry.file, parseGenome(await source.text()));
    }
  }
  return checkpointStart(found.checkpoint, genomes, expected);
}

/** The runs among found checkpoints (`preset-seed`), in the order they were found (Sprint 5.1). */
export function runNames(checkpoints: readonly FoundCheckpoint[]): string[] {
  const names: string[] = [];
  for (const c of checkpoints) {
    const name = runName(c.checkpoint);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** One run's checkpoints, by generation. */
export function checkpointsOfRun(
  checkpoints: readonly FoundCheckpoint[],
  name: string,
): FoundCheckpoint[] {
  return checkpoints.filter((c) => runName(c.checkpoint) === name);
}

/**
 * The run browser's tribe choice (Sprint 5.1): `null` plays every tribe; a tribe id plays only
 * that tribe's champions, the other tribes left out (as if eliminated) so their zones stay empty.
 */
export function onlyTribe(start: EvolutionStart, tribeId: number | null): EvolutionStart {
  if (tribeId === null) return start;
  if (!start.tribes.some((t) => t.tribeId === tribeId && t.alive)) {
    throw new RangeError(`Tribe ${tribeId} has no champions in this generation`);
  }
  return {
    generation: start.generation,
    tribes: start.tribes.map((t) =>
      t.tribeId === tribeId ? t : { ...t, alive: false, genomes: [] },
    ),
  };
}
