#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { buildFeaturedRuns, type FeaturedIo } from './featured.js';

const DEFAULT_OUT = 'packages/viewer/public/runs';

const USAGE = `Usage: pnpm featured <run folder>... [--out <dir>]

  --out <dir>  where the static viewer serves runs from (default ${DEFAULT_OUT}); emptied first
  --help       show this text

Publishes trained runs with the viewer (plan Phase 10): copies the first, last and three
in-between saved generations of each run and writes <out>/index.json. The runs must be trained
by this build with the default config.

Example: pnpm featured runs/featured/small-42 runs/featured/medium-42`;

const io: FeaturedIo = {
  readText: (path) => readFileSync(path, 'utf8'),
  listDir: (path) => readdirSync(path),
  exists: (path) => existsSync(path),
  writeText: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  removeDir: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
};

function run(argv: readonly string[]): number {
  let parsed: { values: { out?: string; help?: boolean }; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { out: { type: 'string' }, help: { type: 'boolean' } },
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }
  if (parsed.values.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.positionals.length === 0) {
    console.error(USAGE);
    return 2;
  }
  try {
    const out = parsed.values.out ?? DEFAULT_OUT;
    const manifest = buildFeaturedRuns(io, parsed.positionals, out);
    for (const r of manifest.runs) {
      console.log(
        `${r.name}: ${r.title} (generations ${r.generations.join(', ')}, ${r.files.length} files)`,
      );
    }
    console.log(`Wrote ${out}/index.json`);
    return 0;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = run(process.argv.slice(2));
