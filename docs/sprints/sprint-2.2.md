# Sprint 2.2 — Spatial Grid + Sensors

- **Phase:** 2 — Creatures (`docs/phases/phase-2.md`)
- **Branch:** `sprint-2.2`
- **Personas:** Simulation Architect (`SpatialGrid`, `ensureGrid`, determinism, allocation-free hot loops), Game Designer (`SensorConfig`, 18-input normalized sensor layout, forest hiding), SDET (hand-made mini-map tests, `fast-check` brute-force oracle, Huge 1,400-creature benchmark)

## Goal

Implement the uniform spatial hash grid (`spatial-grid.ts`) and the exact 18-input normalized creature sensor vector (`sensors.ts`) per `docs/master-plan.md` §2.3, achieving **< 2.5 ms/tick** for all sensor reads across ≈ 1,400 creatures on a `huge` (512×512) map in Node.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | Bump `SIM_VERSION = 2` (`version.ts`), add `SensorConfig` (`config.ts`), update `hashConfig` (`hash.ts`) | Sensor config centralized and hashed; `simVersion` bumped for sensor spec |
| 2 | `spatial-grid.ts`: `SpatialGrid` (`Int32Array` linked lists, `rebuild`, `queryRadius`) | Zero per-tick heap allocations; excludes dead creatures; matches brute force |
| 3 | `sensors.ts`: `SENSOR_COUNT = 18`, `SensorIndex`, `readSensors(world, creature, out?)` | Matches §2.3 inputs 0..17, forest hiding (`vr / 2`), O(1) water field lookup, ring-search food, 8-neighbor `ENEMY_ADJACENT` |
| 4 | `world.ts`: wire `grid`, `rebuildGrid()`, `ensureGrid()`, dirty tracking, rebuild in `tick()` | `tick()` rebuilds before Phase A; standalone `readSensors()` never sees stale grid |
| 5 | Unit & oracle tests (`spatial-grid.test.ts`, `sensors.test.ts`, `hash.test.ts`) | Mini-map tests for all 18 inputs + `fast-check` brute-force sensor & grid oracles |
| 6 | Benchmark (`sensors.bench.ts` + Node measurement on `huge` with 1,400 creatures) | `grid.rebuild + 1,400 × readSensors` < 2.5 ms/tick in Node |
| 7 | `docs/phases/phase-2.md` and `docs/sprints/sprint-2.2.md` | Record measured benchmark timings and retro notes |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` all pass cleanly.
- Measured Huge 1,400-creature sensor benchmark in Node is `< 2.5 ms/tick` and recorded below.

## Out of scope

- Web Worker simulation runner, creature rendering, play/pause/speed HUD — Sprint 2.3.
- Neural network brain, GA, fitness/selection — Phase 3.
- Memory neurons (Sprint 3.5) and call signals (Sprint 4.3).

## Design notes

See `docs/phases/phase-2.md` → "Architecture decisions taken in this phase".

---

## What was done

Implemented the allocation-free uniform spatial hash grid (`spatial-grid.ts`), the 18-input normalized creature sensor vector (`sensors.ts`), and `World` grid lifecycle integration (`world.ts`) in `@evolution-island/sim-core`, bumping `SIM_VERSION` from `1` to `2`.

**Implemented & updated modules (`packages/sim-core/src/`):**
- `version.ts`: bumped `SIM_VERSION` to `2` (18-input sensor spec).
- `config.ts` & `hash.ts`: added `SensorConfig` (`visionRadius: 8`, `forestVisionMultiplier: 0.5`, `countNormalization: 5`, `foodNormalization: 160`) to `SimConfig` and `DEFAULT_CONFIG`, and hashed all 4 fields in `hashConfig`.
- `spatial-grid.ts`: `SpatialGrid` using flat `Int32Array` `head`/`next` linked lists (`cellSize = Math.max(1, Math.floor(visionRadius))`), reverse-index rebuild so buckets yield ascending index order, dead-creature and non-finite-coordinate exclusion, and `queryRadius`.
- `sensors.ts`: `SENSOR_COUNT = 18`, `SensorIndex`, cached Euclidean food ring offset table sorted by `(dx² + dy², dy, dx)` with `visionRadius` range guards, and `readSensors(world, creature, out?)` computing own normalized stats (0–2), nearest visible food (3–4), O(1) nearest water within vision (5–6), nearest visible ally/enemy & normalized counts with `visionRadius * clamp01(forestVisionMultiplier)` forest hiding and lowest-`id` tie-breaking (7–12), current tile food (13), water reachable (14), in forest (15), 8-neighbor `ENEMY_ADJACENT` (16), and bias `1` (17).
- `world.ts` & `index.ts`: wired `World.grid`, `rebuildGrid()`, `ensureGrid()`, dirty tracking on spawn/move/death, and per-tick `rebuildGrid()` before Phase A.

**Benchmark (`node packages/sim-core/test/sensors.bench.ts`, Huge 512×512, 1,400 creatures, 60 ticks after 15 warmup ticks):**
- Full food: `mean = 1.106 ms/tick`, `median = 1.045 ms/tick`, `p95 = 1.475 ms/tick` (target: **< 2.5 ms/tick**).
- 100% depleted food (`food.fill(0)` worst case): `mean = 1.837 ms/tick`, `median = 1.737 ms/tick`, `p95 = 2.342 ms/tick` (target: **< 2.5 ms/tick**).

**Verification:**
- `pnpm lint`: ESLint (`--max-warnings=0`, including `sim-core` determinism guard) and Prettier clean.
- `pnpm typecheck`: root + all 4 packages clean.
- `pnpm test`: 20 test files, **112 tests passed** (4.58 s) — includes `spatial-grid.test.ts` (4 tests including `fast-check` brute-force equivalence, pre-rebuild/corner/shrinking/`NaN` edge cases), `sensors.test.ts` (12 tests covering all 18 inputs, `(dy, dx)` tie-breaks, Euclidean circle edge, forest hiding, observer-in-forest open enemy visibility, zero/extreme config guards, `World.tick()` + `ensureGrid()`, and a 15-seed `fast-check` brute-force sensor oracle), and `hash.test.ts` (all 4 `config.sensor` fields).
- `pnpm build`: all 4 packages built cleanly.
- `pnpm test:e2e`: **4 Playwright Chromium tests passed** (7.9 s).

## Retro

**Went well**
- Precomputing the sorted Euclidean food ring offset table and iterating `SpatialGrid` `Int32Array` `head`/`next` arrays directly inside `readSensors` kept the full 1,400-creature Huge sensor pass at **1.106 ms/tick** (full food) and **1.837 ms/tick** (100% depleted food worst case) with zero per-tick allocations.
- Independent review caught edge-case hardening opportunities (`visionRadius` range/finiteness guards, `forestVisionMultiplier` `[0, 1]` clamping, `NaN` coordinate guards in `SpatialGrid`, zero-norm fallback consistency, and testing depleted-food worst-case latency) before merge.

**Surprises / learnings**
- Vitest's `bench` API references `BenchOptions` from `tinybench`, which pnpm does not hoist into `packages/sim-core/node_modules`; switching `sensors.bench.ts` to a standalone Node TypeScript benchmark importing `@evolution-island/sim-core` keeps strict type-aware linting clean while benchmarking both normal and depleted-food cases directly.

**Next sprint (2.3) should start with:** Worker message protocol & compact typed-array snapshot types in `@evolution-island/shared`, Web Worker simulation loop, interpolated tribe-colored creature sprites, play/pause/speed controls (`1×`, `2×`, `5×`, `20×`, `Max`), and minimal HUD in `@evolution-island/viewer`.
