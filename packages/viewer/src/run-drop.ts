import type { RunFileSource } from './run-loader.js';

/**
 * Turns picked or dropped files into `RunFileSource`s. A browser page can't read local folders
 * on its own (plan §4 Sprint 3.3), so runs arrive through a folder picker (`webkitdirectory`)
 * or drag-and-drop. Only `.json` files are kept: run folders also hold CSV stats.
 */

function isJson(path: string): boolean {
  return path.toLowerCase().endsWith('.json');
}

function fromFile(file: File, path: string): RunFileSource {
  return { path, text: () => file.text() };
}

/** Files from `<input type=file webkitdirectory>` (relative paths) or a plain multi-select. */
export function sourcesFromFileList(files: FileList | readonly File[]): RunFileSource[] {
  const sources: RunFileSource[] = [];
  for (const file of Array.from(files)) {
    const path = file.webkitRelativePath !== '' ? file.webkitRelativePath : file.name;
    if (isJson(path)) sources.push(fromFile(file, path));
  }
  return sources;
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/** `readEntries` returns at most ~100 entries per call; keep reading until it returns none. */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function collectEntry(entry: FileSystemEntry, out: RunFileSource[]): Promise<void> {
  if (isFileEntry(entry)) {
    if (isJson(entry.fullPath)) out.push(fromFile(await fileOf(entry), entry.fullPath));
  } else if (isDirectoryEntry(entry)) {
    for (const child of await readAllEntries(entry)) {
      await collectEntry(child, out);
    }
  }
}

/** Dropped folders are walked recursively; dropped loose files keep their names. */
export async function sourcesFromDrop(data: DataTransfer): Promise<RunFileSource[]> {
  // Entries must be taken synchronously, before the first await (the list is cleared after).
  const entries = Array.from(data.items)
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const files = Array.from(data.files);
  if (entries.length === 0) {
    return sourcesFromFileList(files);
  }
  const sources: RunFileSource[] = [];
  for (const entry of entries) {
    await collectEntry(entry, sources);
  }
  return sources;
}
