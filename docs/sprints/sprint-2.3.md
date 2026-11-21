# Sprint 2.3 — Simulation in a Web Worker + Minimal HUD

- **Phase:** 2 — Creatures (`docs/phases/phase-2.md`)
- **Branch:** `sprint-2.3`
- **Personas:** Simulation Architect (transferable worker protocol, `SimRunner` timing isolation & `pauseAtTick` determinism), Frontend / Rendering Dev (Web Worker loop, pooled `CreatureLayer` with 8 tribe shapes, smooth `(prevX, prevY) -> (x, y)` interpolation, Play/Pause/Step/Speed controls, minimal HUD), SDET (protocol & runner determinism tests, Playwright live worker & mid-run speed-change E2E tests)

## Goal

Run the deterministic simulation (`@evolution-island/sim-core`) inside a dedicated browser Web Worker while the PixiJS main thread renders smooth interpolated tribe-colored creature sprites and a live minimal HUD (tick, generation, actual ticks/sec, population per tribe) with Play/Pause, Step, and `1×` / `2×` / `5×` / `20×` / `Max` speed controls — completing **Milestone M2 — "Life"**.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | `@evolution-island/shared` worker protocol (`worker-protocol.ts`) | Typed `MainToWorkerMessage` / `WorkerToMainMessage` unions, `SIM_SPEEDS`, single-buffer `15` B/creature `packCreatureSnapshot`, `countTribePopulations`, isolated `TransferableMapData` |
| 2 | Worker loop (`sim-runner.ts`, `sim.worker.ts`) | Handles `init`, `setRunning`, `setSpeed`, `step`, `setPauseAtTick`, `requestHash`; stale `runId` messages ignored; zero RNG impact on speed change |
| 3 | Creature sprites & interpolation (`palette.ts`, `interpolation.ts`, `creature-layer.ts`, `map-view.ts`) | Pooled PixiJS sprites with 8 distinct Okabe-Ito shapes, alpha health cue, smooth RAF interpolation at `1×–5×` |
| 4 | Playback UI, minimal HUD & `window.__ei` (`index.html`, `styles.css`, `main.ts`, `debug-hook.ts`) | Play/Pause (+ Spacebar), Step, `1×`/`2×`/`5×`/`20×`/`Max`, live HUD, extended debug hook |
| 5 | Unit & Playwright E2E tests | Protocol, interpolation, palette, `SimRunner` speed-change determinism, and Playwright live-sim + speed-change determinism E2E tests pass |
| 6 | Docs (`docs/phases/phase-2.md`, `docs/sprints/sprint-2.3.md`) | Updated with architecture decisions and verified test results |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` all pass cleanly.
- Changing simulation speed mid-run does not change `worldHash` at tick `N` in both `SimRunner` unit tests and Playwright Chromium E2E tests.

## Out of scope

- Neural network brain, GA, fitness/selection — Phase 3 (`Sprint 3.1`).
- Full leaderboard/charts dashboard, creature inspector, follow-cam, events feed — Phase 6.
- Custom WebGL/sprite-batching optimization for Huge Max speed — Phase 7 (`Sprint 7.1`).

## Design notes

See `docs/phases/phase-2.md` → "Architecture decisions taken in this phase".

---

## What was done

Moved the live simulation loop off the main UI thread into a dedicated browser Web Worker backed by `@evolution-island/shared` transferable snapshot buffers, completing **Milestone M2 — "Life"** while leaving `@evolution-island/sim-core` untouched (`SIM_VERSION = 2`).

**Implemented & updated modules:**
- `packages/shared/src/worker-protocol.ts` & `packages/shared/src/index.ts`: added typed `MainToWorkerMessage` / `WorkerToMainMessage` unions, `SIM_SPEEDS` (`1 | 2 | 5 | 20 | 'max'`, `BASE_TICKS_PER_SECOND = 10`), control sequence acknowledgement (`ackSeq`), cloned `TransferableMapData`, `countTribePopulations`, `packCreatureSnapshot` (`15`-byte aligned single `ArrayBuffer` per snapshot with finiteness and `livingCount` resync guards), and `buildSimSnapshot` / `buildReadyMessage`.
- `packages/viewer/src/worker/sim-runner.ts` & `packages/viewer/src/worker/sim.worker.ts`: implemented host-injectable `SimRunner` and Web Worker entrypoint supporting `init`, `setRunning`, `setSpeed`, `step`, `setPauseAtTick`, and `requestHash`, ignoring stale `runId` messages, bounding `Max` slices at 12 ms / 256 ticks, and keeping simulation RNG streams completely isolated from wall-clock pacing and speed transitions.
- `packages/viewer/src/renderer/` (`palette.ts`, `interpolation.ts`, `creature-layer.ts`, `chunks.ts`, `map-view.ts`): added 8 Okabe-Ito tribe names/shapes/textures (`CanvasSource`), sprite pooling with health alpha modulation, smooth RAF `(prevX, prevY) -> (x, y)` linear interpolation for `1×–5×` speeds, and coalesced vsync rendering.
- `packages/viewer/` (`vite.config.ts`, `index.html`, `src/styles.css`, `src/status.ts`, `src/debug-hook.ts`, `src/main.ts`): configured ES worker builds, added Play/Pause (+ Spacebar shortcut), Step, `1×`/`2×`/`5×`/`20×`/`Max` speed buttons, live minimal HUD (`Tick`, `Gen`, `t/s`, `Pop`, and cached tribe population swatches), and extended `window.__ei` with live telemetry, `pauseAtTick()`, and `requestHash()`.

**Verification:**
- `pnpm lint`: ESLint (`--max-warnings=0`) and Prettier clean across all packages.
- `pnpm typecheck`: root + all 4 packages clean.
- `pnpm test`: 24 test files, **125 tests passed** (`5.02 s`) — includes `worker-protocol.test.ts` (5 tests), `sim-runner.test.ts` (4 tests including constant vs mid-run speed-change determinism and control-sequence acks), `creature-layer.test.ts` (1 pooling + interpolation test), `interpolation.test.ts` (2 tests), `palette.test.ts` (3 tests), and `status.test.ts` (1 test).
- `pnpm build`: all 4 packages built cleanly (`dist/assets/sim.worker-CJqVQzce.js` emitted).
- `pnpm test:e2e`: **6 Playwright Chromium tests passed** (`16.8 s`), verifying initial 200-creature worker initialization, preset switching & chunk culling, deterministic seed replay, camera/overlays/hover, live HUD + Play/Pause/Step/Speed/`Space` controls, and identical `worldHash` at tick 60 across mid-run speed switches (`2× -> 20× -> Max` vs straight `Max`).

## Retro

**Went well**
- Keeping `SimRunner` injectable via `SimRunnerHost` allowed full deterministic unit testing of timing slices, `pauseAtTick`, `ackSeq`, error emission, and mid-run speed switches in Node alongside real Web Worker Playwright E2E runs in Chromium.
- Playwright and independent review caught three subtle main-thread/worker synchronization bugs early: atomic `currentSeed` updates on `'ready'`, monotonic `ackSeq` gating against in-flight snapshots, and emitting `tickDurationMs = 0` on same-tick control snapshots so creatures never replay the prior tick on resume or speed changes.

**Surprises / learnings**
- TypeScript 6's `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>`, requiring explicit `Uint8Array<ArrayBuffer>` / `Float32Array<ArrayBuffer>` on `TransferableMapData` for clean zero-cast `postMessage` transfer lists.

**Next phase (3.1) should start with:** Fixed-topology MLP brain (`brain.ts`) using `@evolution-island/sim-core` deterministic softsign/linear math over `Float32Array` genomes and argmax across all 9 action outputs (`ATTACK`/`SHARE` still acting as `STAY` until Sprint 4.1).
