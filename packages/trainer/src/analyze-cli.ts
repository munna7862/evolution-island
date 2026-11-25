#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { BenchmarkArena } from '@evolution-island/sim-core';
import { analyzeRun, findRunDirs, formatReport, summarize, type AnalyzeIo } from './analyze.js';

const USAGE = `Usage: pnpm analyze --runs <dir> [--json <file>]

  --runs <dir>   a run folder, or a folder of run folders (e.g. the --out of pnpm train --seeds)
  --json <file>  also write every number as JSON
  --help         show this text

Analyses each run at its last completed generation: start-slot winner (highest tribe score),
tribes alive, late benchmark score, hard lock-in, and the benchmark-arena action mix of each
tribe's best hall-of-fame champion (Sprint 4.2).`;

const io: AnalyzeIo = {
  readTextFile: (path) => readFileSync(path, 'utf8'),
  listDir: (path) => readdirSync(path),
  exists: (path) => existsSync(path),
};

function run(argv: readonly string[]): number {
  let values: { runs?: string; json?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        runs: { type: 'string' },
        json: { type: 'string' },
        help: { type: 'boolean' },
      },
    }));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (values.runs === undefined) {
    console.error('--runs is required');
    console.error(USAGE);
    return 2;
  }
  const dirs = findRunDirs(values.runs, io);
  if (dirs.length === 0) {
    console.error(`${values.runs} holds no run (no run.json)`);
    return 2;
  }
  const arenas = new Map<string, BenchmarkArena>();
  const runs = dirs.map((dir) => analyzeRun(dir, io, arenas));
  const summary = summarize(runs);
  process.stdout.write(formatReport(runs, summary));
  if (values.json !== undefined) {
    writeFileSync(values.json, `${JSON.stringify({ runs, summary }, null, 1)}\n`);
  }
  return 0;
}

process.exitCode = run(process.argv.slice(2));
