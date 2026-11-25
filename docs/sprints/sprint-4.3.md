# Sprint 4.3 — Signals experiment

- **Phase:** 4 — Tribes & Competition (`docs/phases/phase-4.md`)
- **Branch:** `sprint-4.3`
- **Personas:** ML / Evolution Engineer (call output, hearing sensors, migration, A/B and mute
  test), Simulation Architect (commit step, determinism, `SIM_VERSION`), Frontend / Rendering Dev
  (ripple rings), SDET (tests, acceptance measurements)

## Goal

Let creatures call (plan §2.3 "Signals"): one call output, heard by allies within `callRadius`
through 3 inputs (loudest call as heard, its offset), behind a config switch and added through
genome migration with zero weights. Find out with an A/B and a mute test whether calls carry
information and help; keep them only if they do, and then re-check the Sprint 4.2 balance bar.
Viewer: a ripple ring when a creature calls.

## Starting point (`main` at `3232dfe`, `SIM_VERSION` 12)

Memory on by default (20 → 12 → 11). Sprint 4.2's balance bar met on Medium seeds 301–340.
Tribes rarely meet before ~200 generations (kills 0.72 per generation per seed late on).

## Design

- **Config** `signals`: `enabled` (default **false**), `callThreshold` 0.5, `callRadius` 16,
  `callCost` 0.1. In the config hash; `--config` can switch it on.
- **Brain spec:** inputs = 18 sensors, M memory, then 3 call inputs (when on); outputs = 9 actions,
  M memory, then 1 call output. Appended at the end, so `migrateGenome` adds them with zero weights.
  With memory and signals: 23 → 12 → 12 = **432 weights** (plan §2.4). The policy needs to know
  whether signals are on (spec sizes alone can't tell 2 memory + signals from other layouts), so
  `createBrainPolicy` takes the brain layout from the config.
- **Call value** = `max(0, softsign(call output))` (0..1), **silent (0) below `callThreshold`**. A
  zero-weight output gives 0, so a migrated genome never calls and behaves exactly as before.
- **Calls are heard on the next tick** (plan §2.3): in Phase A a creature reads the calls committed
  last tick and stores its own as `nextCall`; after Phase B a calling creature pays `callCost`
  energy and counts `callsMade`; after metabolism every creature's `call` becomes its `nextCall`
  (0 if dead). So the order of creatures inside Phase A doesn't matter.
- **Hearing** (3 inputs): over living allies (same tribe, not itself) within `callRadius`
  (Euclidean, `Math.sqrt`), heard strength = call × (1 − distance ÷ callRadius); the loudest wins,
  ties → lowest id. Inputs: heard strength (0..1), dx ÷ callRadius, dy ÷ callRadius; (0, 0, 0) if
  nothing is heard. Enemies can't hear (v1).
- **Hash:** `call` and `nextCall` in the world hash (next to memory); `callsMade` already is.
- **Tribe-score fitness term (plan: "switched on in Sprint 4.3"):** not added. Selection ranks each
  tribe's own members (§2.5), so adding the same `w·tribeScore` to every member changes no ranking
  and no parent choice; it would only shift benchmark scores. Recorded as a plan revision.
- **Viewer:** the creature snapshot carries each creature's call (0..255); creatures calling get a
  ripple ring around them that grows and fades.
- **Tooling:** `pnpm analyze --mute calls` also benchmarks each champion with its call inputs
  zeroed (the plan's mute test).
- `SIM_VERSION` 12 → 13 (tick rule: call commit and cost; brain spec can change).

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file | Before coding |
| 2 | Config, brain layout, call output, hearing sensors, commit step, cost | Unit tests: call 0..1 and silent below threshold; heard next tick only; loudest ally, fading, ties, enemies don't hear, radius; cost and `callsMade` |
| 3 | Migration: memory-only genome → signals brain, zero weights | Same state hash through a whole generation, never calls, same benchmark score |
| 4 | `pnpm analyze --mute calls` | Unit test |
| 5 | Viewer ripple rings (snapshot call byte) | Unit tests for packing and the ring layer; e2e green |
| 6 | Bar proposed to the user before any held-out run; A/B + mute test on held-out seeds; if signals pass, 4.2 balance re-check with signals on | Numbers below |
| 7 | Decision, docs, retro | — |

## Out of scope

- Enemies overhearing calls (open decision, plan §10: "no" for v1).
- A tribe-score fitness term (see above).
