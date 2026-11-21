// Standalone benchmark (not part of `pnpm test`). Run after `pnpm build`:
//   node packages/sim-core/test/brain.bench.ts
// Measures the forward pass alone, then full brain-driven ticks per preset against the
// headless-trainer targets of plan §3.6.
import { performance } from 'node:perf_hooks';
import {
  brainSpecFromConfig,
  createBrainPolicy,
  createBrainScratch,
  createWorld,
  DEFAULT_CONFIG,
  forwardPass,
  SENSOR_COUNT,
  weightCount,
  type MapPresetId,
} from '@evolution-island/sim-core';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);

/** Closed-form genome per tribe (no RNG), weights in [-2, 2]. */
function tribeGenome(tribeId: number): Float32Array {
  const weights = new Float32Array(weightCount(SPEC));
  for (let i = 0; i < weights.length; i++) {
    weights[i] = ((((i + 31 * tribeId) * 7919) % 97) - 48) / 24;
  }
  return weights;
}

function stats(samples: number[]): { mean: number; median: number; p95: number } {
  samples.sort((a, b) => a - b);
  return {
    mean: samples.reduce((acc, v) => acc + v, 0) / samples.length,
    median: samples[Math.floor(samples.length / 2)]!,
    p95: samples[Math.floor(samples.length * 0.95)]!,
  };
}

// 1) Forward pass alone.
{
  const genome = tribeGenome(0);
  const inputs = new Float32Array(SENSOR_COUNT);
  const scratch = createBrainScratch(SPEC);
  const evals = 2_000_000;
  let sink = 0;
  for (let i = 0; i < 100_000; i++) {
    inputs[i % SENSOR_COUNT] = ((i % 7) - 3) / 3;
    sink += forwardPass(SPEC, genome, inputs, scratch)[0]!;
  }
  const t0 = performance.now();
  for (let i = 0; i < evals; i++) {
    inputs[i % SENSOR_COUNT] = ((i % 7) - 3) / 3;
    sink += forwardPass(SPEC, genome, inputs, scratch)[0]!;
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(
    `Forward pass (${SPEC.inputs}-${SPEC.hidden}-${SPEC.outputs}, ${weightCount(SPEC)} weights): ` +
      `${(evals / seconds / 1e6).toFixed(2)} M evals/s (${((seconds / evals) * 1e9).toFixed(0)} ns each)` +
      (Number.isFinite(sink) ? '' : ' [non-finite sink]'),
  );
}

// 2) Full ticks with every creature brain-driven (sensors + forward pass + actions + metabolism).
const TARGET_TPS: Record<MapPresetId, number> = {
  small: 2000,
  medium: 1000,
  large: 400,
  huge: 150,
};
const WARMUP_TICKS = 15;
const MEASURED_TICKS = 60;

function benchPreset(preset: MapPresetId, extraToCreatures?: number): void {
  const genomes = Array.from({ length: 8 }, (_, tribe) => tribeGenome(tribe));
  const world = createWorld({
    preset,
    seed: 42,
    policy: createBrainPolicy(SPEC, (c) => genomes[c.tribeId % genomes.length]!),
  });
  if (extraToCreatures !== undefined) {
    // Top up around the spawn zones (as in sensors.bench.ts) to the most tribes can add up to.
    let n = 0;
    while (world.livingCount < extraToCreatures && n < 8 * 17 * 17) {
      const zone = world.map.spawnZones[n % world.map.spawnZones.length]!;
      n++;
      world.spawnCreature(
        zone.tribeId,
        zone.x + (n % 17) - 8,
        zone.y + (Math.floor(n / 17) % 17) - 8,
      );
    }
  }
  for (let i = 0; i < WARMUP_TICKS; i++) world.tick();
  const creatures = world.livingCount;
  const samples: number[] = [];
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const t0 = performance.now();
    world.tick();
    samples.push(performance.now() - t0);
  }
  const { mean, median, p95 } = stats(samples);
  const tps = 1000 / mean;
  console.log(
    `Brain tick ${preset.padEnd(6)} (${creatures} creatures): mean=${mean.toFixed(3)} ms, ` +
      `median=${median.toFixed(3)} ms, p95=${p95.toFixed(3)} ms → ${tps.toFixed(0)} ticks/s ` +
      `(target > ${TARGET_TPS[preset]}: ${tps > TARGET_TPS[preset] ? 'OK' : 'MISS'})`,
  );
}

benchPreset('small');
benchPreset('medium');
benchPreset('large');
benchPreset('huge');
benchPreset('huge', 1400);
