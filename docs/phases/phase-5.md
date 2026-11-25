# Phase 5 — Persistence & Replays

> Source of truth: `docs/master-plan.md` §4 (Phase 5), §3.3 (determinism, versioned files),
> §3.2 (repo structure), §5 (cross-engine tests).

## Goal

Runs survive interruption and can be shared: training resumes exactly where it stopped, the
viewer browses saved runs, and a single replay file re-runs a world bit for bit in Node and every
major browser engine.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 5.1 | Runs & resumable training | `pnpm train --resume`, run state saved with every checkpoint, kill + resume = uninterrupted run; viewer run browser (run → tribe → generation); incompatible files refused with the reason |
| 5.2 | Save / load / replay | Replay files (seed + config + genomes + spectator events + `simVersion` + hash checkpoints), exported from trainer and viewer, played back in the viewer; same final hash in Node, Chromium, Firefox, WebKit |

## Exit criteria (Phase 5 is done when)

1. A run killed and resumed gives the same files and final state as an uninterrupted run — 5.1.
2. The same replay file gives the same final state hash in Node, Chromium, Firefox and WebKit — 5.2.

## Architecture decisions taken in this phase

1. **Runs resume at generation boundaries (Sprint 5.1).** `EvolutionRun.captureState()` keeps
   what the last `World.startGeneration` was called with plus the RNG streams and tick count
   before it; restoring redoes that call, so the world needs no serialization of its own.
   `resume.json` is rewritten at every checkpoint; `pnpm train --resume` continues from it.
2. **Run browser = run → generation → tribe (Sprint 5.1).** One tribe plays alone by leaving the
   other tribes out of the start (as if eliminated).
