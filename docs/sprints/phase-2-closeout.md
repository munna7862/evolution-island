# Phase 2 close-out

- **Phase:** 2 — Creatures (`docs/phases/phase-2.md`)
- **Branch:** `phase-2-closeout`
- **Why:** a review of Phases 1–2 (after Sprint 2.3 merged) found one sensor design problem, two
  missing checks and some doc drift. Fixing the sensor now is much cheaper than after Phase 3 starts
  training genomes against it.
- **Personas:** Simulation Architect (sensor spec, RNG streams, golden hashes), SDET (cross-engine
  check, fps measurement), Scrum Master (plan and doc upkeep)

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | Food-direction sensor (inputs 3–4, 0-based) ignores the own tile and tiles below `sensor.minVisibleFood` | Unit tests for threshold, own-tile skip and `minVisibleFood = 0`; brute-force oracle updated and passing |
| 2 | Decision policies use a dedicated `rng.policy` stream | Test: a policy's extra draws leave `rng.tick` and all positions unchanged |
| 3 | `SIM_VERSION` 2 → 3 | Golden hashes recorded for v3 |
| 4 | Golden-hash check in Node **and** Chromium | `golden-hash.test.ts` + Playwright test assert the same pinned values |
| 5 | Measure "60 fps on Medium with 200 random creatures" (Phase 2 exit criterion 4) | Numbers recorded below |
| 6 | Docs: plan §2.1/§2.2/§2.3/§10/§12, `phase-2.md` | Match the code |
| 7 | Remove dead `SimRunner.currentTickDurationMs()` | — |

## What was done

**1. Food sensor.** `readSensors` now scans the vision ring from `ring[0] + 1` (`ring[0]` is always the
own tile) and only stops at tiles with `food >= sensor.minVisibleFood` (new config field, default 20 =
one bite, included in `hashConfig`). The own tile stays visible through input 13 (current-tile food).
Effect, measured on seed 42 with the random policy:

| Preset | Creatures whose food direction reads (0, 0) — before | after |
|--------|------------------------------------------------------|-------|
| Small, tick 0 / 200 | 45/50 / 44/50 | 0/50 / 0/50 |
| Medium, tick 0 / 200 | 177/200 / 164/200 | 0/200 / 0/200 |

Before, a creature standing on any land tile (1,170 of 1,463 walkable tiles on Small carry food) got
(0, 0), and grazed tiles counted again one tick later because regrowth starts at once.

**2. Policy stream.** `RngStreams` gained `policy` (derived like the others, hashed in `hashWorld`).
`World.tick()` passes `rng.policy` to the policy; `rng.tick` now only drives the Phase B shuffle.

**3–4. `SIM_VERSION = 3` and golden hashes.** `packages/sim-core/test/golden-hashes.ts` pins Small /
seed 42: map hash and `world.hash()` at ticks 0, 100 and 600. The Node test and a new Playwright test
(which runs the worker to each tick via `pauseAtTick` and calls `requestHash()`) assert the same
values. Chromium matched Node on the first run.

**5. Frame rate**, Medium, seed 42, 200 random creatures, 1280×800, production build, 5 s per speed
after 1 s warm-up. "Viewer fps" is the viewer's own counter (frames actually redrawn);
"long frames" are `requestAnimationFrame` gaps over 20 ms.

| Speed | Hardware GPU (RTX 3050 Laptop, D3D11): viewer fps | long frames | Software WebGL (SwiftShader, as in CI): viewer fps |
|-------|-----|-----|-----|
| 1× (10 t/s) | **60** | 0 / 300 | 27–46 |
| 5× (50 t/s) | **60** | 0 / 299 | 27–34 |
| 20× (200 t/s; 189 → 149 alive) | 48–54 | 0 / 299 | 25–34 |
| Max (~49k t/s; all creatures already dead) | 27–29 | 0 / 299 | 21–28 |

The exit criterion holds on real hardware: a steady 60 fps at 1× and 5× with no dropped frames. At
20× and Max the main thread still runs at a clean 60 Hz (zero long frames); the lower counts are
content updates — the worker sends a snapshot at most every 16 ms (20×) or 33 ms (Max) by design,
and above 5× there is no interpolation between them. Measured with headless Playwright because the
desktop app's browser pane was backgrounded and throttled to 0.5 fps, which says nothing about the
viewer.

**Sensor benchmark** (Huge, 1,400 creatures) after the change, 3 runs: full food mean 1.11–1.33
ms/tick; 100% depleted food mean 1.84–2.09 ms, median ~1.78–1.83 ms (target < 2.5 ms). `main`'s
code benchmarked in the same session gave depleted-food means of 1.84–2.06 ms with the same p95
spread (2.3–3.0 ms), so the change costs nothing measurable; the p95 swing is machine noise.

**6–7.** Plan and phase doc updated (see the 2026-11-21 "Phase 2 close-out" revision note in
`docs/master-plan.md`); dead method removed.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (25 files, 129 tests), `pnpm build`,
`pnpm test:e2e` (7 tests, Chromium) all pass.

## Retro

**Went well**
- Measuring before deciding: a ten-line probe turned "the food sensor might be weak" into
  "it reads (0, 0) for 78–90% of creatures", and the same probe confirmed the fix.
- The golden-hash test makes the `CLAUDE.md` rule "behaviour change ⇒ bump `simVersion`"
  enforceable, and doubles as the first Node ↔ browser determinism check.

**Surprises / learnings**
- Random creatures survive much longer than the 466-tick "never eats or drinks" figure: random `EAT`
  and `DRINK` (2 of 9 actions) keep all 50 alive past tick 600 on Small. Deaths are still covered by
  the world tests, not by the golden run.
- The viewer's "fps" is a redraw rate, not a refresh rate. At high speeds it is bounded by snapshot
  cadence, so it is the wrong number for judging smoothness there; long-frame counts are the better one.
- The desktop app's browser pane reports `visibilityState: hidden` when the app window is not in
  front, so it can't be used for performance numbers.

**Follow-ups**
- The golden run uses the random policy, which never reads sensors, so it does not yet prove that
  sensors compute identically in Node and the browser. In Sprint 3.1, switch the golden scenario to a
  brain with fixed weights so sensors and the forward pass are both covered.
- 20× shows ~50 redraws/s on Medium. If the plan's "60 fps at 20×" (§3.6) should mean 60 *redraws*,
  lower `FIXED_HIGH_SPEED_SNAPSHOT_INTERVAL_MS` or interpolate above 5× — a Sprint 7.1 item at the latest.
- Run the golden-hash Playwright test in Firefox and WebKit too (plan Sprint 5.2), ideally earlier,
  since Sprint 3.3 already replays trainer genomes in the viewer.
