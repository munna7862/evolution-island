#!/usr/bin/env node
import { replayMain } from './replay-command.js';

process.exitCode = replayMain(process.argv.slice(2));
