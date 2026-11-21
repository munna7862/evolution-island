# Sprint 1.2 — Viewer v0

- **Phase:** 1 — The World (`docs/phases/phase-1.md`)
- **Branch:** `sprint-1.2`
- **Personas:** Frontend / Rendering Dev (PixiJS chunked terrain, camera, UI shell), Simulation Architect (`window.__ei` debug hook contract), SDET (camera/chunk unit tests, Playwright WebGL render tests)

## Goal

Build the Vite + PixiJS v8 spectator app (`@evolution-island/viewer`) rendering generated `WorldMap` islands from chunked GPU textures with smooth pan/zoom, preset and seed controls, spawn/hotspot overlays, and the `window.__ei` test debug hook (Milestone M1: "A world exists").

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | Add `pixi.js` (v8) to `packages/viewer` + SwiftShader WebGL flag in `playwright.config.ts` | `pnpm install --frozen-lockfile` succeeds and headless Chromium renders WebGL |
| 2 | `renderer/palette.ts` & `renderer/chunks.ts` | 64×64 chunk grid, RGBA pixel builder with biome & food-richness tinting, AABB off-screen culling |
| 3 | `renderer/camera.ts` | `fitMapToViewport`, clamped `panCamera`, cursor-anchored `zoomCameraAt`, `screenToTile` |
| 4 | `renderer/map-view.ts` | PixiJS v8 WebGL `Application`, `BufferImageSource` nearest-neighbor chunk sprites, texture cleanup on map switch, spawn/hotspot overlay graphics, pointer pan/zoom/hover |
| 5 | App shell + `debug-hook.ts` (`index.html`, `styles.css`, `main.ts`, `status.ts`) | Preset selector (`small`/`medium`/`large`/`huge`), seed input + Generate/Random, Overlays toggle, Reset View, status/legend bar, `window.__ei` exposing `mapHash`, `tick`, `population`, `chunkCount`, `visibleChunkCount`, `renderCount`, `camera` |
| 6 | Unit & Playwright E2E tests | Unit tests for chunks & camera; Playwright tests for load/render, preset switching, seed determinism, and pan/zoom/reset |
| 7 | `docs/sprints/sprint-1.2.md` | Record what was done, bundle size, test counts, and retro notes |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` all pass cleanly.
- Switching presets (`small`, `medium`, `large`, `huge`) re-renders chunked textures, updates `window.__ei`, and passes Playwright assertions with zero console/page errors.

## Out of scope

- Web Worker simulation loop, creature sprites, play/pause/speed controls, HUD stats — Phase 2 (Sprint 2.3).
- uPlot charts, creature inspector, follow-cam, events feed — Phase 6.

## Design notes

See `docs/phases/phase-1.md` and `docs/master-plan.md` §3.6 (chunked terrain textures rather than one sprite per tile).

---

## What was done

Implemented Viewer v0 (`@evolution-island/viewer`) with PixiJS v8 WebGL chunked terrain rendering, interactive pan/zoom/hover, preset & seed controls, spawn/hotspot overlays, shared canonical seed parsing, and the `window.__ei` test debug hook.

**Implemented modules:**
- `packages/shared/src/seed.ts`: `parseSeed(raw, fallback)` converting canonical base-10 safe integers to `number` and preserving arbitrary strings, keeping Viewer UI/URLs consistent with `sim-core` and the future CLI trainer.
- `packages/viewer/src/renderer/palette.ts`: cartographic RGB biome colors, per-biome food-richness shading & hotspot tinting derived from `MapGenConfig` (`tileColorRgb`), Okabe-Ito color-blind-safe 8-tribe colors (`tribeColor`), and legend metadata (`BIOME_LEGEND`).
- `packages/viewer/src/renderer/camera.ts`: `fitMapToViewport`, clamped `panCamera`, cursor-anchored `zoomCameraAt`, and `screenToTile` with guards for tiny viewports, non-positive factors, and `NaN`.
- `packages/viewer/src/renderer/chunks.ts`: 64×64 tile chunk partitioning (`computeChunkGrid` → 1 / 4 / 16 / 64 chunks across Small / Medium / Large / Huge), `buildChunkPixels`, and AABB viewport culling (`computeVisibleChunkIndices`).
- `packages/viewer/src/renderer/map-view.ts`: PixiJS v8 WebGL `Application` (`autoStart: false` on-demand rendering, `BufferImageSource` with `format: 'rgba8unorm'` and `scaleMode: 'nearest'`), explicit `ResizeObserver` renderer resize, full GPU texture/context cleanup (`context: true`), cached chunk descriptors, zoom-scaled spawn/hotspot overlays, pointer pan (without layout thrashing), horizontal-safe smooth wheel zoom, double-click fit, and hover callbacks.
- `packages/viewer/src/debug-hook.ts`, `main.ts`, `status.ts`, `styles.css`, `index.html`, `css.d.ts`: full-viewport dark UI (`touch-action: none`, `.is-dragging` cursor), preset selector, seed input + Generate/Random, Overlays toggle, Reset View, tile hover readout, biome legend, `?preset=...&seed=...` URL sync via `history.replaceState`, fatal-error surfacing, and `window.__ei`.
- `packages/viewer/playwright.config.ts`: added SwiftShader + ANGLE WebGL launch flags for reliable headless Chromium rendering.

**Verification:**
- `pnpm lint`: ESLint (`--max-warnings=0`) and Prettier clean.
- `pnpm typecheck`: root + all 4 packages clean.
- `pnpm test`: 15 test files, **74 tests passed** (4.80 s) — includes `shared/test/seed.test.ts` (3 tests) and `viewer/test/{camera,chunks,palette,status}.test.ts` (11 tests).
- `pnpm build`: all 4 packages built cleanly (`vite build` in 300 ms; main viewer chunk `286.91 kB` / `85.86 kB` gzip).
- `pnpm test:e2e`: **4 Playwright Chromium tests passed** (8.4 s) covering load/render (`window.__ei`, `rendererType`), switching across `small` / `medium` / `large` / `huge` + off-screen chunk culling on zoom, seed determinism across UI/URL/`Random`, hover readout, overlays toggle, horizontal-wheel immunity, and pan/zoom/reset with zero console or page errors.

## Retro

**Went well**
- Keeping camera math, chunk culling, and biome/hotspot coloring in pure TypeScript modules (`camera.ts`, `chunks.ts`, `palette.ts`, `shared/seed.ts`) made them fast to unit-test in Node while keeping `map-view.ts` focused on PixiJS v8 integration.
- `BufferImageSource` with `scaleMode: 'nearest'` and 64×64 chunks renders crisp pixel tiles across all presets (up to 512×512 Huge in 64 chunks) with off-screen culling and zero per-pan allocations.

**Surprises / learnings**
- PixiJS v8 `BufferImageSource` defaults `Uint8Array` resources to `bgra8unorm` unless `format: 'rgba8unorm'` is explicitly specified; `autoStart: false` avoids burning 60fps CPU/GPU on a static map (while requiring an explicit `app.render()` in `setOverlaysVisible`); and `app.destroy` requires `context: true` to dispose `GraphicsContext` GPU buffers.
- Pixi's `resizeTo` only listens to `window` resize events and defers via `rAF`, so removing `resizeTo` and calling `app.renderer.resize()` directly inside `ResizeObserver` prevents stale canvas sizing and resize races.
- Independent review caught `tileColorRgb` hard-coding `105` and dividing Forest by Grass's `baseGrassFood`, horizontal wheel events zooming out (`deltaY === 0`), and viewer string `'42'` vs `sim-core` numeric `42` seed divergence (solved via `parseSeed`).
- Because `packages/viewer/src/tsconfig.json` uses `"types": []`, Vite CSS side-effect imports require `declare module '*.css'` (`src/css.d.ts`), and Playwright specs need `import type {} from '../src/debug-hook.js'` for `window.__ei` typing.

**Next sprint (2.1) should start with:** `creature.ts`, metabolism (energy/hydration/health drain & regen, death), food regrowth active list, and Phase 2 rule-validated actions (`MOVE_N/E/S/W`, `STAY`, `EAT`, `DRINK`) in `sim-core` (Phase 2).
