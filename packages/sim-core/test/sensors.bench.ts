import { performance } from 'node:perf_hooks';
import { createWorld, readSensors, SENSOR_COUNT } from '@evolution-island/sim-core';

const WARMUP_TICKS = 15;
const MEASURED_TICKS = 60;
const TARGET_CREATURES = 1400;

const world = createWorld({ preset: 'huge', seed: 42 });
const maxAttempts = world.map.spawnZones.length * 17 * 17;
let n = 0;
while (world.livingCount < TARGET_CREATURES && n < maxAttempts) {
  const zone = world.map.spawnZones[n % world.map.spawnZones.length]!;
  n++;
  const ox = (n % 17) - 8;
  const oy = (Math.floor(n / 17) % 17) - 8;
  world.spawnCreature(zone.tribeId, zone.x + ox, zone.y + oy);
}

if (world.livingCount < TARGET_CREATURES) {
  throw new Error(
    `Expected ${TARGET_CREATURES} spawned creatures, got ${world.livingCount} after ${n} attempts`,
  );
}

const out = new Float32Array(SENSOR_COUNT);

function runOneTick(): void {
  world.rebuildGrid();
  for (const creature of world.creatures) {
    if (!creature.alive) continue;
    readSensors(world, creature, out);
  }
}

function measureScenario(label: string): void {
  for (let i = 0; i < WARMUP_TICKS; i++) {
    runOneTick();
  }

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const t0 = performance.now();
    runOneTick();
    samples.push(performance.now() - t0);
  }

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length;
  const median = samples[Math.floor(samples.length / 2)]!;
  const p95 = samples[Math.floor(samples.length * 0.95)]!;

  console.log(
    `Huge sensor benchmark [${label}] (${world.livingCount} creatures, ${MEASURED_TICKS} ticks): ` +
      `mean=${mean.toFixed(3)} ms/tick, median=${median.toFixed(3)} ms/tick, p95=${p95.toFixed(3)} ms/tick`,
  );
}

measureScenario('full food');

world.map.food.fill(0);
measureScenario('100% depleted food');
