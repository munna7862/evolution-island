# Phase 2 — Creatures (no learning yet)

> Source of truth: `docs/master-plan.md` §4 (Phase 2), §2.3 (creatures, stats, actions, sensors), §3.3–3.4 (two-phase tick, determinism, spatial grid), §3.6 (performance targets).

## Goal

Achieve **Milestone M2 — "Life"**: creatures spawn on generated islands, drain energy/hydration, forage and drink, die on health 0 or maxAge, sense their surroundings in < 2.5 ms/tick on Huge maps, and run smoothly at 60 fps inside a Web Worker with a minimal spectator HUD.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 2.1 | Creatures, metabolism, actions | `Creature` model, energy/hydration/health drain & regen, death, active-list food regrowth, rule-validated actions (`MOVE_N/E/S/W`, `STAY`, `EAT`, `DRINK`), two-phase `World.tick()`, `randomActionPolicy`, `SIM_VERSION = 1` |
| 2.2 | Spatial grid + sensors | Spatial hash grid for nearest ally/enemy, outward ring search for food, water field lookup, 18-input normalized sensor vector, Huge 1,400-creature sensor benchmark < 2.5 ms/tick |
| 2.3 | Simulation in a Web Worker + minimal HUD | Worker protocol in `shared`, worker-driven simulation transferring compact snapshots, tribe-colored interpolated creature sprites, play/pause/speed controls (`1×`, `2×`, `5×`, `20×`, `Max`), minimal HUD |

## Exit criteria (Phase 2 is done when)

1. Unit tests pass for every metabolism rule and every Phase 2 action (including slow tiles, blocking, and `EAT`/`DRINK` intake rules).
2. A creature that stands still without eating or drinking dies well before the shortest generation (1,500 ticks) ends.
3. Sensor reads match exact hand-made mini-map expectations and benchmark < 2.5 ms/tick for ≈ 1,400 creatures on Huge (Node).
4. Viewer runs the simulation in a Web Worker at 60 fps on Medium with 200 random creatures, and changing speed mid-run does not change the state hash at tick N.

## Architecture decisions taken in this phase

1. **`SIM_VERSION` bumped to `1` in Sprint 2.1 and `2` in Sprint 2.2.** Per `CLAUDE.md`, introducing tick rules (2.1) and the 18-input sensor vector (2.2) bumps `simVersion`.
2. **Two-phase tick with seeded per-tick shuffle.** Phase A evaluates all living creatures' policies in ascending `id` order against the same world snapshot; Phase B resolves intents in a `rng.tick.shuffle(...)` order so lower IDs gain no permanent first-move advantage.
3. **Float32-exact active depleted-tile list & isolated `WorldMap.food`.** `World` shallow-clones caller-supplied `WorldMap`s with a fresh `Float32Array` `food` copy (keeping terrain arrays zero-copy) and rounds food deltas/regrowth via `Math.fround` before checking fullness, tracking depleted tiles in a packed `Int32Array` with O(1) swap-remove upon reaching `maxFood`.
4. **4-adjacent water reachability (`isWaterReachable`).** Matches Sprint 1.1's drinkable-water rule and `MOVE_N/E/S/W`: `DRINK` succeeds on `ShallowWater` or when 4-adjacent to `ShallowWater`/`DeepWater`.
5. **Slow-tile cooldown semantics.** Entering `ShallowWater` or `Forest` costs `2×` `moveEnergyCost` and sets `moveCooldown = 1`. On the creature's next tick, `MOVE_*` falls back to `STAY` while `moveCooldown` decrements to `0` (non-move actions like `EAT`/`DRINK`/`STAY` execute normally and also decrement `moveCooldown`), allowing movement again on the following tick.
6. **Pluggable `DecisionPolicy` starting with `randomActionPolicy`.** Keeps Phase 2 decoupled from the Phase 3 neural network brain while exercising the full tick loop and `rng.tick` stream.
7. **Allocation-free `SpatialGrid` & lazy `ensureGrid()` (Sprint 2.2).** `SpatialGrid` stores living creatures in `Int32Array` `head`/`next` linked lists with `cellSize = Math.max(1, Math.floor(visionRadius))` so every radius query checks at most 3×3 cells (for integer `visionRadius >= 1`) with zero per-tick allocations. `World.tick()` rebuilds once before Phase A while standalone `readSensors()` calls lazily call `world.ensureGrid()` so stale grids are never read. Inputs 0–2 (`ENERGY`, `HP`, `AGE`) are normalized to `[0, 1]`, and `ENEMY_ADJACENT` (input 16) checks the 8-neighborhood via the occupancy grid regardless of `visionRadius` or forest hiding.
8. **Precomputed Euclidean food ring table (Sprint 2.2).** `readSensors()` scans cached `(dx, dy)` offsets sorted by `(dx² + dy², dy, dx)` for deterministic row-major tie-breaking and immediate early exit on the first visible food tile (`food > 0`).

## Risks

| Risk | Mitigation |
|------|------------|
| `EAT`/`DRINK` intake or regrowth math drifts across JS engines | Stick strictly to `+ - * /` and allow-listed `Math.min/max/floor`; verify with deterministic `hashWorld` tests |
| Active depleted-tile list gets out of sync with `map.food` | Maintain `isDepleted` flag array alongside `depletedTiles` and assert invariants with `fast-check` |
| Sensor search or worker snapshot transfer bottlenecks Huge maps | Defer spatial grid & sensors to Sprint 2.2 benchmark and typed-array transfers to Sprint 2.3 |
