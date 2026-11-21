# Sprint 1.1 — Seeded RNG + Map Generator

- **Phase:** 1 — The World (`docs/phases/phase-1.md`)
- **Branch:** `sprint-1.1` (or current working branch)
- **Personas:** Simulation Architect (RNG streams, hash, water field, determinism), Game Designer (presets, biomes, spawn fairness, hotspots), SDET (unit, property, fairness & timing tests)

## Goal

Implement the deterministic simulation foundation (`rng.ts`, `hash.ts`, `config.ts`) and procedural island map generator (`packages/sim-core/src/map/*`) with full unit, property, connectivity, and fairness verification.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | `rng.ts`: `cyrb128` + `sfc32` + named independent streams (`map`, `spawn`, `evolution`, `tick`) | Same seed → identical draws; advancing one stream does not affect sibling streams; `getState`/`fromState` round-trips; `fast-check` range/permutation properties pass |
| 2 | `hash.ts`: `StateHasher`, `hashConfig`, `hashMap` | Canonical float handling (`-0` == `+0`, canonical `NaN`), length-prefixed strings/arrays, 64-bit hex digest |
| 3 | `config.ts`: `MAP_PRESETS` (`small`, `medium`, `large`, `huge`) and `DEFAULT_CONFIG` | Matches master plan §2.2 & §2.1 balance rules; all map parameters centralized in config |
| 4 | `map/simplex.ts`: pure deterministic 2D simplex noise + fBM | Zero external dependencies; passes `sim-core` ESLint determinism guard |
| 5 | `map/water-field.ts`: exact $O(W \cdot H)$ 2D Euclidean Distance Transform | Hand-made mini-map tests + `fast-check` comparison against brute-force oracle |
| 6 | `map/generator.ts`: radial island generator, spawn zones, contested hotspots, fairness + connectivity retry | Border is `DeepWater`; 4-connected BFS reaches all spawns & hotspots; capacity ≥ 2× `popCapPerTribe`; food & water within ±15% across tribes |
| 7 | `docs/phases/phase-1.md` and `docs/sprints/sprint-1.1.md` | Document architecture decisions, measured timings, retry counts, and retro |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` all pass cleanly.
- Same-seed-same-hash, flood-fill connectivity, ±15% fairness, and water-field oracle tests are part of `pnpm test`.
- Observed map generation timings, retry counts, and walkable-tile densities are recorded below.

## Out of scope

- PixiJS viewer, chunked terrain rendering, pan/zoom, `window.__ei` debug hook — Sprint 1.2.
- Creatures, metabolism, spatial grid, sensors — Phase 2.
- Neural network brain, GA, trainer CLI — Phase 3.

## Design notes

See `docs/phases/phase-1.md` → "Architecture decisions taken in this phase".

---

## What was done

Implemented the deterministic simulation foundation (`rng.ts`, `hash.ts`, `config.ts`) and procedural island map generator (`packages/sim-core/src/map/*`) with full unit, property, connectivity, and fairness tests.

**New modules (`packages/sim-core/src/`):**
- `rng.ts`: `normalizeSeed`, `cyrb128`, `RngStream` (`sfc32` with 15-draw warmup, `nextUint32`, `nextFloat`, overflow-safe `nextRange`, unbiased `nextInt`, `shuffle`, `getState`/validated `fromState`), `createRngStream`, `deriveRngStream` (length-prefixed to avoid delimiter collisions), `createRngStreams` (`map`, `spawn`, `evolution`, `tick`).
- `config.ts`: `MAP_PRESETS` (`small`, `medium`, `large`, `huge`) and `DEFAULT_CONFIG` centralizing all noise, island falloff, biome food, spawn/pond/hotspot geometry, fairness, and retry parameters.
- `hash.ts`: `StateHasher` (dual 32-bit mixed lanes, canonical `-0` → `+0` including float32 underflow via `Math.fround`, canonical `NaN`, length-prefixed strings/arrays), `hashConfig`, `hashMap`.
- `map/types.ts`: `Biome` enum (`DeepWater`, `ShallowWater`, `Sand`, `Grass`, `Forest`, `Mountain`), predicates (`isWalkable`, `isWater`, `isSlow`, `hidesCreatures`), `SpawnZone`, `Hotspot`, `WaterField`, `WorldMap`.
- `map/simplex.ts`: self-contained 2D simplex noise (`createSimplex2D`) and `fbm2D` using only `+ - * /`, `Math.floor`, and `Math.sqrt` (zero external dependencies).
- `map/water-field.ts`: linear-time $O(W \cdot H)$ exact 2D Euclidean Distance Transform (`computeWaterField`), breaking ties by smallest row-major tile index (`wy * width + wx`), validating bounds, and returning `NO_WATER_OFFSET` (`32767`) if no water exists.
- `map/generator.ts`: `unitCirclePoint` (trigonometry-free polynomial without `-0`), `floodFillWalkable` (4-connected BFS), and `generateMap` (radial island falloff, two-pass spawn conditioning with dry spawn/hotspot cores, contested hotspots, ±15% reachable food & reachable drinkable-water fairness verification, and deterministic `map::<attempt>` retries).

**Measured map generation & density metrics** (observed on Node v24.13.0 after review fixes):

| Preset | Dimensions | Retries (`attempt`) | Generation time | Walkable tiles | Walkable tiles / starting creature |
|--------|------------|---------------------|-----------------|----------------|------------------------------------|
| `small` (10 seeds) | 64×64 | 0–8 | 2.3–22.2 ms | 1,439–1,594 | 28.8–31.9 |
| `medium` (5 seeds) | 128×128 | 0–16 | 14.4–87.6 ms | 5,835–6,210 | 29.2–31.1 |
| `large` (3 seeds) | 256×256 | 1–6 | 43.8–141.0 ms | 23,545–24,376 | 49.1–50.8 |
| `huge` (3 seeds) | 512×512 | 0–6 | 103.6–596.7 ms | 91,639–93,293 | 76.4–77.7 |

## Retro

**Went well**
- Keeping `simplex.ts` and `unitCirclePoint` self-contained inside `packages/sim-core/src` meant zero external runtime dependencies and 100% static coverage by the ESLint determinism guard.
- The two-pass $O(W \cdot H)$ Euclidean Distance Transform matched the brute-force oracle across 200 `fast-check` random grids on the first pass, including exact diagonal tie-breaking.
- Even on 512×512 `huge` maps with 8 tribes and reachable drinkable-water fairness checks, `generateMap` succeeds in 0–6 retries (~104–597 ms).

**Surprises / learnings**
- Independent review caught subtle edge cases: `ShallowWater` is walkable so spawn/hotspot cores needed explicit dry-land clearing; counting offshore `DeepWater` masked drinkable-water imbalances; `nextRange` needed overflow-safe span math; `writeFloat32` needed `Math.fround` before `-0` canonicalization; and `large`/`huge` `fairnessRadius` needed tightening (`30` → `25`, `44` → `36`) to keep fairness zones disjoint.
- Calling Vitest's `expect(...)` inside a per-tile loop on 512×512 maps dominated test runtime (~28 s); tallying mismatches inside the loop and asserting once per map tests every tile just as strictly in ~5 s total.
- `TextEncoder` is not part of TypeScript's pure `ES2023` lib (`types: []` in `sim-core`), so `StateHasher.writeString` encodes UTF-16 code units via `charCodeAt` directly.
- Walkable density is ~29–78 walkable tiles per starting creature (versus ~82–219 raw grid tiles because the island sits inside a deep-water ring); revisit in Phase 4 if Small/Medium maps feel tight at `popCapPerTribe`.

**Next sprint (1.2) should start with:** Vite + PixiJS Viewer v0 rendering `WorldMap` via chunked terrain textures, pan + zoom, preset/seed controls, and the `window.__ei` debug hook.
