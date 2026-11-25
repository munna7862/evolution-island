# Sprint 7.1 — Large / Huge optimisation

- **Phase:** 7 — Scale & World Events (`docs/phases/phase-7.md`)
- **Branch:** `sprint-7.1`
- **Personas:** Performance Engineer, Frontend / Rendering Dev, SDET

## Goal

Plan §4 Sprint 7.1: profiling, typed-array (struct-of-arrays) creature storage if needed, sprite
batching, culling off-screen. ✅ Meets §3.6 targets on Large and Huge:

| Preset | Browser: fps / fastest smooth speed | Headless trainer |
|--------|-------------------------------------|------------------|
| Large  | 60 fps / 20×                        | > 400 ticks/sec  |
| Huge   | ≥ 30 fps / 5×                       | > 150 ticks/sec  |

## Design

- **Measure the worst case.** `pnpm bench [--preset large,huge] [--ticks 1000]`
  (`trainer/src/bench.ts`, `bench-cli.ts`): a preset's first generation with every creature kept
  fed and healthy, so every tick senses, thinks and acts for the full population (480 on Large,
  1,200 on Huge). Real training is cheaper: creatures die and generations end early. It reports
  ticks/s of the process's CPU time as well as wall time, because this machine's wall-clock
  numbers swing 3–5× with other programs' load, and exits 1 if a target is missed.
- **Browser check.** `e2e/perf.spec.ts`, opt-in with `PERF=1` (skipped in CI: shared runners and
  software WebGL measure nothing useful). It plays Large at 20× and Huge at 5× on the real GPU and
  averages the HUD's fps and ticks/s over 8 s.
- **Fix what the measurements show** (below).

## What was done

**Profile (Huge, all alive, 400 ticks):** sensors 34 % (`readSensors`: food ring, spatial grid),
brain forward pass 24 %, map generation 13 % (one-off), tick bookkeeping 4 %, actions 3 %,
territory 2 %, GC 3 %. Nothing dominates beyond the inherent per-creature work.

**Trainer (worst case, `pnpm bench`, CPU ticks/s, quiet machine):** Large ≈ 930–1,450 (target 400),
Huge ≈ 590–710 (target 150). Under the other program's load wall time fell as low as 136 on Huge,
which first looked like a miss; CPU time showed the code was not the cause.

**Tried and dropped:** a bounds-check-free food ring scan with precomputed tile-index offsets.
Golden hashes were identical, but over 8 alternating runs per preset against `main` the gain was
inside the noise (Large 930–1,450 vs 930–1,430; Huge 590–660 vs 405–710), so the simpler code
stays.

**Browser (Chromium, RTX 3050, `PERF=1 pnpm --filter @evolution-island/viewer exec playwright test e2e/perf.spec.ts`):**

| Case | Before | After |
|------|--------|-------|
| Large 20× | 40 fps, 200 ticks/s | 57 fps, 200 ticks/s |
| Huge 5×   | 60 fps, 50 ticks/s  | 60 fps, 50 ticks/s  |

Large at 20× drew ~40 frames/s even though nothing was slow: the fps counter counts frames that
changed, and at 20× (no interpolation) a frame changes only when a snapshot arrives. The worker
emitted one when ≥ 16 ms had passed, checked on slices every ~5 ms, so effectively every ~20 ms.
Lowering the threshold to 12 ms lifts it to ~57 drawn frames/s (8 ms gave the same, so 12 ms keeps
fewer messages); the remaining gap is rAF frames with no new snapshot yet. Terrain chunks were
already culled and all creature sprites already batch (one texture per tribe), so no renderer work
was needed.

**Tests:** `trainer/test/bench.test.ts` (3: whole population alive, clock → ticks/s, same options →
same hash). No simulation change (`SIM_VERSION` 13; golden hashes unchanged).

**Verification:** see Reviews.

## Retro

**Went well**
- Measuring CPU time instead of wall time separated "the code is slow" from "the machine is busy".
- The browser shortfall turned out to be a scheduling threshold, not rendering cost.

**Surprises / learnings**
- Wall-clock benchmarks on this machine vary 3–5× within minutes (other programs at 70–99 % CPU).
  Compare variants with alternating fixed-length runs and CPU time.
- Software WebGL (the e2e default, SwiftShader) caps Large at ~30 fps by itself; perf has to be
  measured on the GPU.
