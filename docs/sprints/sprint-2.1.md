# Sprint 2.1 — Creatures, Metabolism, Actions

- **Phase:** 2 — Creatures (`docs/phases/phase-2.md`)
- **Branch:** `sprint-2.1`
- **Personas:** Simulation Architect (two-phase `World.tick()`, occupancy, active regrowth, `hashWorld`), Game Designer (balance numbers in `config.ts`, metabolism & action rules), SDET (rule unit tests, standing-still survival test, `fast-check` invariants)

## Goal

Implement the creature data model, metabolism (drain, regen, death), active-list food regrowth, rule-validated Phase 2 actions (`MOVE_N/E/S/W`, `STAY`, `EAT`, `DRINK`), and the deterministic two-phase `World.tick()` loop driven by `randomActionPolicy`.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | Bump `SIM_VERSION = 1` (`version.ts`) & add `CreatureConfig` / `FoodConfig` (`config.ts`) | All balance numbers live in `config.ts`; standing-still creature dies well before 600 ticks |
| 2 | Update `hashConfig` and add `hashWorld(world)` (`hash.ts`) | Captures tick, generation, food array, `rng.tick` state, and all creature states/stats in `id` order |
| 3 | `creature.ts`: `Creature`, `createCreature`, `applyMetabolism` | Energy/hydration drain, starvation/dehydration health drain, > 50% health regen, death at `health <= 0` or `age >= maxAge` |
| 4 | `actions.ts`: `Action` (all 9 enum slots), `isWaterReachable`, `applyAction` | Validates bounds, walkable tiles, 1-creature-per-tile occupancy, slow-tile `2×` cost & cooldown, `EAT` bite/need cap, `DRINK` adjacency/need cap; `ATTACK`/`SHARE` act as `STAY` |
| 5 | `world.ts`: `World`, `createWorld`, `randomActionPolicy` | Spawns tribes in `spawnZones` via `rng.spawn`, active depleted-tile list regrowth, two-phase `tick()` with `rng.tick.shuffle`, dead creatures vacate `occupancy` |
| 6 | Unit, determinism, and property tests (`creature.test.ts`, `actions.test.ts`, `world.test.ts`, `hash.test.ts`) | All metabolism & action rules tested; same seed → same `world.hash()` after N ticks; `fast-check` invariants hold |
| 7 | Docs: `docs/phases/phase-2.md` and `docs/sprints/sprint-2.1.md` | Record completed items, standing-still survival tick, test counts, and retro notes |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` all pass cleanly.
- Every metabolism and Phase 2 action rule has unit tests, plus determinism and `fast-check` invariant tests.

## Out of scope

- Spatial hash grid and 18-input creature sensors — Sprint 2.2.
- Web Worker simulation runner, creature rendering, play/pause/speed HUD — Sprint 2.3.
- Neural network brain, GA, fitness/selection — Phase 3.
- `ATTACK` combat damage/kills and `SHARE` energy transfer — Phase 4 (Sprint 4.1).

## Design notes

See `docs/phases/phase-2.md` → "Architecture decisions taken in this phase".

---

## What was done

Implemented the Phase 2.1 creature model, metabolism, Phase 2 rule-validated actions, and deterministic two-phase `World.tick()` loop in `@evolution-island/sim-core`, bumping `SIM_VERSION` from `0` to `1`.

**Implemented & updated modules (`packages/sim-core/src/`):**
- `version.ts`: bumped `SIM_VERSION` to `1`.
- `config.ts`: added `CreatureConfig` and `FoodConfig` to `SimConfig` and `DEFAULT_CONFIG` (`maxHealth`, `maxEnergy`, `maxHydration`, drain rates, `moveEnergyCost`, `slowTileMoveMultiplier`, `slowTileMoveCooldown`, starvation/dehydration drains, health regen, bite sizes, `attackEnergyCost`, `maxAgeMultiplier`, `food.regrowthRate`).
- `hash.ts`: updated `hashConfig` to include `creature` and `food` fields; added `hashWorld(world)` hashing `SIM_VERSION`, `preset`, `seed`, `hashConfig`, `maxAge`, tick/generation/livingCount, `map.hash`, `map.food`, all three RNG stream states (`spawn`, `evolution`, `tick`), and all creatures in `id` order.
- `creature.ts`: `createCreature`, `NO_MOVE_DIR`, and `applyMetabolism` (energy/hydration drain, starvation/dehydration health drain, > 50% health regeneration, aging, death on `health <= 0` or `age >= maxAge` when `maxAge > 0`). Measured standing-still death tick: **466 ticks** (well under 600 ticks and Small's 1,500-tick generation).
- `actions.ts`: `Action` (`MOVE_N`, `MOVE_E`, `MOVE_S`, `MOVE_W`, `STAY`, `EAT`, `DRINK`, `ATTACK`, `SHARE`), integer/bounds-guarded `isWaterReachable`, and `applyAction` (bounds/walkability/1-creature-per-tile checks, `2×` energy cost + `slowTileMoveCooldown` on `ShallowWater`/`Forest`, safe `<= 0` cooldown checks, `EAT` & `DRINK` actual-gained accounting preventing full-stat fitness farming, and `ATTACK`/`SHARE` falling back to `STAY` until Sprint 4.1).
- `world.ts` & `index.ts`: `World`, `createWorld`, `NO_CREATURE`, and `randomActionPolicy` — `floodFillWalkable`-filtered tribe spawning via `rng.spawn` (failing loudly on short-spawn), isolated `Float32Array` `map.food` copy on `options.map`, Float32-exact (`Math.fround`) `consumeFood` & active depleted-tile list regrowth with O(1) swap-remove, validated `moveCreature`, two-phase `tick()` with reusable `livingBuffer` (Phase A ascending `id`, Phase B `rng.tick.shuffle`), occupancy cleanup on death, and `world.hash()`.

**Verification:**
- `pnpm lint`: ESLint (`--max-warnings=0`, including `sim-core` determinism guard) and Prettier clean.
- `pnpm typecheck`: root + all 4 packages clean.
- `pnpm test`: 18 test files, **96 tests passed** (5.19 s) — includes unit, determinism, and `fast-check` property tests in `creature.test.ts` (6), `actions.test.ts` (6), `world.test.ts` (9, including 550-tick death/occupancy and active-list invariants), plus `hashWorld` / config sensitivity in `hash.test.ts` (6).
- `pnpm build`: all 4 packages built cleanly.
- `pnpm test:e2e`: **4 Playwright Chromium tests passed** (8.6 s).

## Retro

**Went well**
- Keeping `Action` at all 9 slots from Sprint 2.1 (`ATTACK`/`SHARE` acting as `STAY`) keeps the future brain output layout stable into Phase 4.
- Maintaining `isDepleted` alongside the packed `depletedTiles` `Int32Array` makes resource regrowth O(depleted tiles) per tick while handling custom test maps that start partially depleted.

**Surprises / learnings**
- Independent review caught a `Float32Array` rounding trap: `Math.fround(60 - 0.15) + 0.15` evaluates to `59.999998... < 60` in float64 even though storing into `Float32Array` rounds to `60.0f`, which left full tiles stuck in `depletedTiles`. Computing `Math.fround` before comparing against `maxFood` and computing `actualTaken = available - Math.fround(available - requested)` keeps food conservation and active-list eviction bit-exact.
- Reusing a caller-passed `WorldMap` without cloning `food` would leak mutations across worlds/tests and invalidate `map.hash`; shallow-cloning `WorldMap` with `new Float32Array(options.map.food)` isolates mutable food while keeping terrain arrays zero-copy.
- `standingStillDeathTick = 466` gives a clean ~134-tick margin under the 600-tick standing-still ceiling while allowing creatures time to find nearby food and water on Small/Medium maps.

**Next sprint (2.2) should start with:** `spatial-grid.ts` (fast neighbor lookup) and `sensors.ts` (the 18 normalized inputs from master plan §2.3), plus the < 2.5 ms/tick benchmark for ≈ 1,400 creatures on Huge.
