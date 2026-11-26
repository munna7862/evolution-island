import {
  CHECKPOINT_FILE_NAME,
  checkpointDirName,
  FEATURED_RUNS_FILE,
  parseCheckpoint,
  pickFeaturedGenerations,
  serializeFeaturedRuns,
  type CheckpointFile,
  type FeaturedRun,
  type FeaturedRunsManifest,
} from '@evolution-island/shared';
import { DEFAULT_CONFIG, hashConfig, SIM_VERSION } from '@evolution-island/sim-core';

/**
 * `pnpm featured` (plan §4 Phase 10): publishes trained runs with the static viewer. For each run
 * folder it copies the checkpoints of a few generations (`pickFeaturedGenerations`) with their
 * hall-of-fame genome files into `<out>/<run name>/`, and writes `<out>/index.json`. Only runs of
 * this build's rules and default config are accepted: the viewer could not play the others.
 */
export interface FeaturedIo {
  readText(path: string): string;
  listDir(path: string): readonly string[];
  exists(path: string): boolean;
  writeText(path: string, text: string): void;
  /** Removes `path` and everything under it, if it exists. */
  removeDir(path: string): void;
}

export class FeaturedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeaturedError';
  }
}

const PRESET_TITLES: Readonly<Record<string, string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
};

/** A run folder's name, as the `?run=` link uses it. */
export function featuredName(runDir: string): string {
  const base = runDir.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop() ?? '';
  const name = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  if (!/^[a-z0-9]/.test(name)) throw new FeaturedError(`"${runDir}" has no usable folder name`);
  return name;
}

function readCheckpoints(io: FeaturedIo, runDir: string): Map<number, CheckpointFile> {
  const dir = `${runDir}/checkpoints`;
  if (!io.exists(dir)) throw new FeaturedError(`${runDir} has no checkpoints folder`);
  const byGeneration = new Map<number, CheckpointFile>();
  for (const entry of io.listDir(dir)) {
    const file = `${dir}/${entry}/${CHECKPOINT_FILE_NAME}`;
    if (!/^gen-\d+$/.test(entry) || !io.exists(file)) continue;
    const checkpoint = parseCheckpoint(io.readText(file));
    byGeneration.set(checkpoint.generation, checkpoint);
  }
  if (byGeneration.size === 0) throw new FeaturedError(`${runDir} has no saved generation`);
  return byGeneration;
}

/** Copies the runs and writes the manifest; returns it. `outDir` is emptied first. */
export function buildFeaturedRuns(
  io: FeaturedIo,
  runDirs: readonly string[],
  outDir: string,
): FeaturedRunsManifest {
  const configHash = hashConfig(DEFAULT_CONFIG);
  const runs: FeaturedRun[] = [];
  const copies: { from: string; to: string }[] = [];
  for (const runDir of runDirs) {
    const name = featuredName(runDir);
    if (runs.some((r) => r.name === name)) throw new FeaturedError(`two runs are named "${name}"`);
    const checkpoints = readCheckpoints(io, runDir);
    const generations = pickFeaturedGenerations([...checkpoints.keys()]);
    const files: string[] = [];
    for (const generation of generations) {
      const checkpoint = checkpoints.get(generation)!;
      if (checkpoint.simVersion !== SIM_VERSION || checkpoint.configHash !== configHash) {
        throw new FeaturedError(
          `${runDir} generation ${generation} was trained by simVersion ${checkpoint.simVersion} ` +
            `with config ${checkpoint.configHash}; this build is simVersion ${SIM_VERSION} with ` +
            `default config ${configHash}. Train it again with this build (no --config).`,
        );
      }
      const folder = `checkpoints/${checkpointDirName(generation)}`;
      const names = [
        CHECKPOINT_FILE_NAME,
        ...checkpoint.tribes.flatMap((t) => t.hallOfFame.map((e) => e.file)),
      ];
      for (const file of names) {
        files.push(`${folder}/${file}`);
        copies.push({
          from: `${runDir}/${folder}/${file}`,
          to: `${outDir}/${name}/${folder}/${file}`,
        });
      }
    }
    const first = checkpoints.get(generations[0]!)!;
    const last = generations[generations.length - 1]!;
    runs.push({
      name,
      title: `${PRESET_TITLES[first.preset] ?? first.preset} · seed ${String(first.seed)} · ${last} generations`,
      preset: first.preset,
      seed: first.seed,
      generations,
      files,
    });
  }
  const manifest: FeaturedRunsManifest = { simVersion: SIM_VERSION, configHash, runs };
  io.removeDir(outDir);
  for (const copy of copies) io.writeText(copy.to, io.readText(copy.from));
  io.writeText(`${outDir}/${FEATURED_RUNS_FILE}`, serializeFeaturedRuns(manifest));
  return manifest;
}
