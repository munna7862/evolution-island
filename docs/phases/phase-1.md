# Phase 1 — The World

> Source of truth: `docs/master-plan.md` §4 (Phase 1), §2.1–2.2 (world, biomes, map presets), §3.3 (determinism & performance).

## Goal

Deterministic, seeded, balanced island worlds across all four presets (Small, Medium, Large, Huge) with precomputed water distance fields, plus a fast PixiJS Viewer v0 capable of rendering any generated map with pan/zoom and a test debug hook.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 1.1 | Seeded RNG + map generator | `sfc32` named streams, `config.ts`, `hash.ts`, 2D simplex noise, biome/island generator, balanced spawn zones & contested hotspots, exact nearest-water field |
| 1.2 | Viewer v0 | Vite + PixiJS tile-map renderer using chunked textures, pan/zoom, preset + seed selector, `window.__ei` debug hook, Playwright render test |

## Exit criteria (Phase 1 is done when)

1. Same seed + preset + config produces the exact same `WorldMap` hash across repeated runs (Sprint 1.1).
2. All tribe spawn zones and contested hotspots are connected by 4-way walkable tiles, verified by flood-fill (Sprint 1.1).
3. Food and water within `fairnessRadius` of every tribe spawn zone are within ±15% of the tribe mean, and each spawn zone holds at least 2× `popCapPerTribe` reachable walkable tiles (Sprint 1.1).
4. Nearest-water field (`waterDx`, `waterDy`) matches exact Euclidean distances on hand-made mini maps and random property tests (Sprint 1.1).
5. Viewer v0 loads, renders chunked terrain textures, pans/zooms, switches presets, and passes Playwright smoke checks via `window.__ei` (Sprint 1.2).

## Architecture decisions taken in this phase

1. **Self-contained 2D simplex noise (`packages/sim-core/src/map/simplex.ts`).** Instead of adding an external `simplex-noise` dependency that ESLint cannot inspect for forbidden `Math` calls (noted in Sprint 0.1 retro), `sim-core` vendors a minimal 2D simplex implementation using only `+ - * /`, `Math.floor`, and `Math.sqrt`. Every line is statically checked by the determinism lint rule and `sim-core` stays zero-dependency.
2. **Trigonometry-free `unitCirclePoint(turn)`.** `Math.sin`, `Math.cos`, and `Math.PI` are disallowed in `sim-core/src` because transcendental functions can vary across JS engines. Spawn ring and hotspot angles use quadrant range reduction (`|r| <= π/4`) with degree-12 (`cos`) / degree-13 (`sin`) Taylor polynomials (`unitCirclePoint(turn)`), using only `+ - * /` and literal `PI`, accurate to better than `1e-12`.
3. **Exact $O(W \cdot H)$ 2D Euclidean Distance Transform for the water field.** `computeWaterField` runs a two-pass separable EDT (row scan + Felzenszwalb–Huttenlocher lower envelope), breaking exact squared-distance ties by smallest row-major tile index (`wy * width + wx`). Water tiles report `(0, 0)` and no-water maps report `(NO_WATER_OFFSET, NO_WATER_OFFSET)`.
4. **4-connected flood-fill connectivity.** Because creature movement (`MOVE_N`, `MOVE_E`, `MOVE_S`, `MOVE_W`) is 4-directional, spawn zones and hotspots are verified reachable via 4-connected BFS rather than 8-connected.
5. **Gentle spawn conditioning + deterministic retry.** Elevation/moisture fBM with smooth radial island falloff generates natural islands, spawn zones are gently cleared of impassable terrain (with dry cores for spawns and hotspots) and given a small organic pond only if local drinkable water is scarce, and contested hotspots are placed between tribes and at the island center. Every candidate map is verified against capacity, 4-connected reachability, and ±15% reachable food and reachable drinkable-water fairness checks, retrying with derived stream `seed::map::<attempt>` up to `maxGenerationAttempts`.
6. **`SIM_VERSION` stays `0` in Sprint 1.1.** Per `CLAUDE.md`, `SIM_VERSION` tracks sensor list, brain spec, and tick rules, none of which exist until Phases 2–3.

## Risks

| Risk | Mitigation |
|------|------------|
| Natural noise asymmetry causes excessive retries on 8-tribe Huge maps | Gentle local spawn-zone conditioning + radial hotspot symmetry keeps retry counts low while preserving organic island coastlines; monitor retry counts across seeds |
| Nearest-water EDT tie-breaking differs from a naive scan | Property-test `computeWaterField` with `fast-check` against an independent brute-force oracle on random grids |
| `sim-core` lint rule blocks helper math | Keep all math strictly within `+ - * /` and the 9 allow-listed `Math` members; run `pnpm lint` on every change |
