#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { MAP_PRESETS, type MapPresetId } from '@evolution-island/sim-core';
import { benchWorstCase, type BenchClock } from './bench.js';

const USAGE = `Usage: pnpm bench [--preset <id>[,<id>...]] [--ticks <n>]

  --preset  presets to measure (default large,huge)
  --ticks   ticks measured per preset after 50 warm-up ticks (default 1000)

Worst-case speed (plan §3.6): every creature kept alive for the whole measurement. Prints ticks/s
of CPU time (steadier when other programs load the machine) and of wall time.`;

/** §3.6 headless trainer targets (ticks/s). */
const TARGETS: Record<MapPresetId, number> = { small: 2000, medium: 1000, large: 400, huge: 150 };

const clock: BenchClock = {
  wallMs: () => performance.now(),
  cpuMs: () => {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000;
  },
};

function isPreset(id: string): id is MapPresetId {
  return Object.hasOwn(MAP_PRESETS, id);
}

function run(argv: readonly string[]): number {
  let values: { preset?: string; ticks?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        preset: { type: 'string' },
        ticks: { type: 'string' },
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
  const presets = (values.preset ?? 'large,huge').split(',');
  const ticks = Number(values.ticks ?? '1000');
  const bad = presets.filter((p) => !isPreset(p));
  if (bad.length > 0 || !Number.isSafeInteger(ticks) || ticks < 1) {
    console.error(bad.length > 0 ? `Unknown preset: ${bad.join(', ')}` : '--ticks must be ≥ 1');
    console.error(USAGE);
    return 2;
  }
  let allMet = true;
  for (const preset of presets.filter(isPreset)) {
    const r = benchWorstCase({ preset, ticks, warmupTicks: 50, seed: 42 }, clock);
    const met = r.cpuTicksPerSec > TARGETS[preset];
    allMet &&= met;
    console.log(
      `${preset}: ${r.creatures} creatures, ${r.cpuTicksPerSec.toFixed(0)} ticks/s CPU, ` +
        `${r.wallTicksPerSec.toFixed(0)} ticks/s wall (target > ${TARGETS[preset]}: ` +
        `${met ? 'met' : 'MISSED'}), hash ${r.hash}`,
    );
  }
  return allMet ? 0 : 1;
}

process.exitCode = run(process.argv.slice(2));
