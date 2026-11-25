import {
  createEvolutionRun,
  DEFAULT_CONFIG,
  type MapPresetId,
  type Seed,
  type SimConfig,
} from '@evolution-island/sim-core';

/**
 * Worst-case speed benchmark (Sprint 7.1, plan §3.6): a preset's first generation with every
 * creature kept alive and fed, so each tick senses, thinks and acts for the full population —
 * the most a tick ever costs. Training is never this slow: creatures die and generations end early.
 */
export interface BenchOptions {
  readonly preset: MapPresetId;
  readonly ticks: number;
  readonly warmupTicks: number;
  readonly seed: Seed;
  readonly config?: SimConfig;
}

export interface BenchResult {
  readonly preset: MapPresetId;
  readonly creatures: number;
  readonly ticks: number;
  /** Ticks per second of this process's CPU time (less sensitive to other programs than wall time). */
  readonly cpuTicksPerSec: number;
  readonly wallTicksPerSec: number;
  /** World hash after the run: the same options always give the same hash. */
  readonly hash: string;
}

/** Clocks in milliseconds, injected so tests stay deterministic. */
export interface BenchClock {
  wallMs(): number;
  cpuMs(): number;
}

export function benchWorstCase(options: BenchOptions, clock: BenchClock): BenchResult {
  const config = options.config ?? DEFAULT_CONFIG;
  const run = createEvolutionRun({ preset: options.preset, seed: options.seed, config });
  const world = run.world;
  const { maxEnergy, maxHydration, maxHealth } = config.creature;
  const tick = (): void => {
    for (const c of world.creatures) {
      c.energy = maxEnergy;
      c.hydration = maxHydration;
      c.health = maxHealth;
    }
    world.tick();
  };
  for (let i = 0; i < options.warmupTicks; i++) tick();
  const wall0 = clock.wallMs();
  const cpu0 = clock.cpuMs();
  for (let i = 0; i < options.ticks; i++) tick();
  const wallS = (clock.wallMs() - wall0) / 1000;
  const cpuS = (clock.cpuMs() - cpu0) / 1000;
  return {
    preset: options.preset,
    creatures: world.livingCount,
    ticks: options.ticks,
    cpuTicksPerSec: cpuS > 0 ? options.ticks / cpuS : Number.POSITIVE_INFINITY,
    wallTicksPerSec: wallS > 0 ? options.ticks / wallS : Number.POSITIVE_INFINITY,
    hash: world.hash(),
  };
}
