// Dropping a run folder on the viewer (Sprint 3.3 review): Playwright can only drop loose files,
// so the folder walk (`webkitGetAsEntry` → FileSystemDirectoryEntry readers) is tested here with
// stand-in entries that behave like Chromium's: `readEntries` hands out small batches.
import {
  hallOfFameFileName,
  serializeCheckpoint,
  serializeGenome,
  type CheckpointContent,
} from '@evolution-island/shared';
import {
  brainSpecFromConfig,
  DEFAULT_CONFIG,
  hashConfig,
  weightCount,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { sourcesFromDrop, sourcesFromFileList } from '../src/run-drop.js';
import { defaultCheckpoint, loadCheckpoint, scanRunFiles } from '../src/run-loader.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);
const CONFIG_HASH = hashConfig(DEFAULT_CONFIG);

type Tree = { readonly [name: string]: string | Tree };

/** Entries as a browser builds them for a dropped item; `batch` = entries per readEntries call. */
function entryFor(name: string, node: string | Tree, parent: string, batch: number) {
  const fullPath = `${parent}/${name}`;
  if (typeof node === 'string') {
    return {
      isFile: true,
      isDirectory: false,
      name,
      fullPath,
      file(success: (file: File) => void) {
        success(new File([node], name));
      },
    } as unknown as FileSystemEntry;
  }
  const children = Object.entries(node).map(([n, child]) => entryFor(n, child, fullPath, batch));
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader() {
      let next = 0;
      return {
        readEntries(success: (entries: FileSystemEntry[]) => void) {
          const slice = children.slice(next, next + batch);
          next += slice.length;
          success(slice);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

function dataTransfer(entries: readonly (FileSystemEntry | null)[], files: readonly File[] = []) {
  return {
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer;
}

function checkpointText(generation: number): string {
  const content: CheckpointContent = {
    configHash: CONFIG_HASH,
    preset: 'small',
    seed: 7,
    generation,
    tribes: [0, 1].map((tribeId) => ({
      tribeId,
      alive: true,
      size: 3,
      hallOfFame: [
        { rank: 1, generation, benchmarkScore: 600, file: hallOfFameFileName(tribeId, 1) },
      ],
    })),
  };
  return serializeCheckpoint(content);
}

function checkpointFolder(generation: number): Tree {
  const genome = serializeGenome(SPEC, new Float32Array(weightCount(SPEC)).fill(0.1), CONFIG_HASH);
  return {
    'checkpoint.json': checkpointText(generation),
    [hallOfFameFileName(0, 1)]: genome,
    [hallOfFameFileName(1, 1)]: genome,
  };
}

/** A run folder as the trainer writes it, with a non-JSON file the walk must skip. */
const RUN: Tree = {
  'run.json': '{}',
  'stats.csv': 'generation\n1\n',
  checkpoints: { 'gen-0001': checkpointFolder(1), 'gen-0010': checkpointFolder(10) },
};

describe('sourcesFromDrop (folders)', () => {
  it('walks a dropped run folder, every readEntries batch, keeping JSON files only', async () => {
    const sources = await sourcesFromDrop(dataTransfer([entryFor('small-7', RUN, '', 2)]));
    expect(sources.map((s) => s.path).sort()).toEqual([
      '/small-7/checkpoints/gen-0001/checkpoint.json',
      '/small-7/checkpoints/gen-0001/tribe-0-hof-1.genome.json',
      '/small-7/checkpoints/gen-0001/tribe-1-hof-1.genome.json',
      '/small-7/checkpoints/gen-0010/checkpoint.json',
      '/small-7/checkpoints/gen-0010/tribe-0-hof-1.genome.json',
      '/small-7/checkpoints/gen-0010/tribe-1-hof-1.genome.json',
      '/small-7/run.json',
    ]);
  });

  it('gives the loader what it needs to play the latest generation', async () => {
    const sources = await sourcesFromDrop(dataTransfer([entryFor('small-7', RUN, '', 1)]));
    const scan = await scanRunFiles(sources);
    expect(scan.checkpoints.map((c) => c.label)).toEqual(['Gen 1 · small-7', 'Gen 10 · small-7']);
    const latest = defaultCheckpoint(scan)!;
    const start = await loadCheckpoint(latest, sources, { brain: SPEC, configHash: CONFIG_HASH });
    expect(start.generation).toBe(10);
    expect(start.tribes.map((t) => t.genomes.length)).toEqual([3, 3]);
  });

  it('takes several dropped items, folders and loose files alike', async () => {
    const sources = await sourcesFromDrop(
      dataTransfer([
        entryFor('gen-0010', checkpointFolder(10), '', 100),
        entryFor('notes.json', '{}', '', 100),
        entryFor('readme.txt', 'hi', '', 100),
      ]),
    );
    expect(sources.map((s) => s.path)).toEqual([
      '/gen-0010/checkpoint.json',
      '/gen-0010/tribe-0-hof-1.genome.json',
      '/gen-0010/tribe-1-hof-1.genome.json',
      '/notes.json',
    ]);
    expect(await sources[3]!.text()).toBe('{}');
  });

  it('falls back to the plain file list when the browser gives no entries', async () => {
    const file = new File(['{}'], 'checkpoint.json');
    Object.defineProperty(file, 'webkitRelativePath', { value: '' });
    const sources = await sourcesFromDrop(dataTransfer([null], [file]));
    expect(sources.map((s) => s.path)).toEqual(['checkpoint.json']);
  });
});

describe('sourcesFromFileList (folder picker)', () => {
  it('keeps the relative paths of a picked folder and skips non-JSON files', () => {
    const picked = ['small-7/run.json', 'small-7/stats.csv'].map((path) => {
      const file = new File(['x'], path.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      return file;
    });
    expect(sourcesFromFileList(picked).map((s) => s.path)).toEqual(['small-7/run.json']);
  });
});
