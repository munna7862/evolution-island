#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { main } from './main.js';
import { trainSeed } from './train-seed.js';
import { runSeedInWorker } from './worker-runner.js';

process.exitCode = await main(
  process.argv.slice(2),
  {
    log: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
    cpus: availableParallelism(),
    readTextFile: (path) => readFileSync(path, 'utf8'),
  },
  {
    inProcess: (job, onProgress) => Promise.resolve(trainSeed(job, onProgress)),
    inWorker: runSeedInWorker,
  },
);
