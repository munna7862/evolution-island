# Phase 7 — Scale & World Events

> Source of truth: `docs/master-plan.md` §4 (Phase 7), §3.6 (performance targets), §2 (world).

## Goal

Reach **Milestone M6 — "Epic scale"**: the Huge map with 8 tribes running at the §3.6 speeds in
the trainer and the browser, and a world that fights back — seasons, droughts, floods, moving
food — including disasters a spectator drops in, recorded in replays.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 7.1 | Large / Huge optimisation | Profiling, a worst-case benchmark (`pnpm bench`) and an opt-in browser perf test; §3.6 targets met on Large and Huge |
| 7.2 | Climate & disasters | Winter, droughts, floods (water field recomputed), migrating food zones; spectator-triggered events recorded in replays |

## Exit criteria (Phase 7 is done when)

1. §3.6 targets met on Large and Huge (trainer ticks/s; browser fps at the fastest smooth speed) — 7.1.
2. A unit test per world event; a replay containing spectator events reproduces the same state
   hash — 7.2.

## Architecture decisions taken in this phase

1. **No struct-of-arrays rewrite (Sprint 7.1).** The plan listed typed-array creature storage "if
   needed". The worst case (every creature alive all generation) already runs 2–4× above the
   trainer targets. A bounds-check-free food scan made no difference beyond timing noise and was
   dropped. Speed work stays measurement-driven: `pnpm bench` first.
2. **Fast-speed snapshots below one frame (Sprint 7.1).** At 20× the worker now sends a snapshot
   at most every 12 ms (was 16 ms). Slices run every few ms, so the 16 ms threshold produced a new
   picture only every ~20 ms, and the viewer drew ~45 frames/s with nothing slow anywhere.
