# Sprint 3.5 — Memory experiment

- **Phase:** 3 — Brains & Evolution (`docs/phases/phase-3.md`)
- **Branch:** `sprint-3.5`
- **Personas:** ML / Evolution Engineer (memory neurons, migration, A/B design), Simulation
  Architect (tick rules, determinism, `SIM_VERSION`), Game Designer (sparse-water variant), SDET
  (unit and property tests, acceptance measurements)

## Goal

Give creatures 2 memory neurons (plan §2.3 "Memory & signals", §2.4) behind a config switch, added
through genome migration with zero weights, and find out with an A/B in the benchmark arena whether
memory helps: on the normal Small map and on a sparse-water variant, where water is often out of
sight and remembering where it was should matter most. Keep memory only if the A/B says it helps
(plan §4 Sprint 3.5, §8 "Memory or signals add complexity without helping").

## Starting point (`main` at `15f1c42`, `SIM_VERSION` 8)

Sprint 3.4 reached "it learns!": on 20 held-out Small seeds the mean generation-100 / generation-1
benchmark ratio is 2.52, 16 of 20 seeds reach 2× generation 1 and 2× a STAY-only brain, 30 of 40
tribes reach 1.5×. Generation-100 champions walk to the shore and stay there; foraging trips away
from water are rare. Known limitations: hard lock-in ("always EAT"/"always DRINK", 2 of 40
held-out tribes) and champion noise (8 more tribes below 1.5× whose generation-100 champion scored
low although the tribe had bred creatures that lived through whole generations).

## Design

- **Switch:** `brain.memoryNeurons` in `config.ts` (default **0** = off; the experiment uses 2). In
  the config hash; a whole number in `--config` files.
- **Brain spec:** inputs = 18 sensors + M memory inputs, outputs = 9 actions + M memory outputs.
  The memory inputs come after the bias (sensor indices 0–17 unchanged), the memory outputs after
  the 9 actions. With M = 2: 20 → 12 → 11 = 20·12 + 13·11 = **383 weights** (plan §2.4 gives 432
  with signals as well). Argmax still runs over the 9 action outputs only.
- **Memory values:** each creature carries `memory` (M float32 values, 0 at spawn). In Phase A the
  brain policy reads them as inputs, then stores the squashed memory outputs (softsign, so always
  within −1..1) as the creature's new memory, sensed on the next tick (plan §2.3). A creature reads
  only its own memory, and reads it before writing it, so no separate commit step is needed (calls
  in Sprint 4.3 will need one: allies hear them).
- **Migration:** `migrateGenome(from, to, weights)` copies every weight of a smaller brain into a
  brain with more inputs and/or outputs (same hidden size) and gives the new ones weight 0. A
  migrated memory-off genome never writes anything but 0 to memory and never reads it, so it acts
  exactly as before.
- **State hash:** `hashWorld` adds each creature's memory. A new `hashWorldState` hashes only what
  evolves during a run (ticks, food, RNG streams, creatures' positions, stats and actions), not the
  config hash, genomes or memory, so two worlds under different brain configs can be compared
  (the migration test).
- **`SIM_VERSION` 8 → 9:** the brain spec can change, the tick has a new rule (memory), and the
  world hash covers memory. Behaviour with memory off is unchanged (same benchmark scores and
  champion behaviour as `SIM_VERSION` 8), but golden hashes change because the hash covers more.

## A/B design

- **Arms:** memory off (`brain.memoryNeurons` 0) vs on (2), everything else the shipped defaults,
  trained from scratch with `pnpm train --preset small --generations 100 --config <file>`.
- **Maps:** the normal Small preset, and a sparse-water variant made only with `--config` (map
  generator settings: less natural shallow water, smaller ponds placed farther from the spawn
  centre), so water is out of sight from much of the spawn zone. The benchmark arena uses the
  same variant (its map comes from the run's config).
- **Acceptance bar:** to be fixed with the user **before any held-out seed is run** (below).

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file: design, backlog, definition of done | Written before coding |
| 2 | `brain.memoryNeurons` config switch (default 0), in the config hash and `--config` whole-number fields | Unit tests: spec sizes with 0 and 2, override validation |
| 3 | Brain spec with memory inputs/outputs; creature `memory`; brain policy feeds memory in and squashes memory outputs back | Unit tests: memory stays within −1..1 (property test, extreme weights, a whole generation); memory is fed back on the next tick |
| 4 | `migrateGenome` (zero weights for new inputs/outputs) | Unit tests: layout, a migrated genome gives the same state hash (`hashWorldState`) as before migration over a whole generation, memory stays 0, same benchmark score |
| 5 | `hashWorld` covers memory; `hashWorldState`; `SIM_VERSION` 9; golden hashes re-recorded | `pnpm test`, `pnpm test:browser`, `pnpm test:e2e` green |
| 6 | Sparse-water variant config (`--config`), measured: water in sight from the spawn zone, arena map | Numbers recorded below |
| 7 | Noise check (memory off only, tuning seeds) to size the bar; bar proposed to the user and fixed here and in the plan | Bar committed before any held-out run |
| 8 | A/B on held-out seeds, run once; lock-in and champion noise reported separately | Every seed's numbers recorded |
| 9 | Decision (keep / leave off), retro, `phase-3.md`, plan revision note | — |

## Definition of done

- Memory switch, migration and tests as above; `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:browser`, `pnpm build`, `pnpm test:e2e` pass locally and in CI.
- A/B run once on the held-out seeds against the bar fixed beforehand, every seed's numbers here.
- Decision recorded: memory kept (and how it is switched on) or left off, with the reason.

## Out of scope

- Signals / calls and the tribe-score fitness term — Sprint 4.3.
- Migrating saved runs or genome files across `SIM_VERSION`s, resuming runs — Sprint 5.1.
- Showing memory values in the viewer — the creature inspector, Sprint 6.2.
- Tuning anything other than the memory switch (the A/B keeps every other default).
