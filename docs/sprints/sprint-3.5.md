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
  trained from scratch with `pnpm train`. Both arms use the same seeds, so each pair shares its
  maps; their genomes differ from generation 1 on (383 vs 333 random weights).
- **Maps:** the normal Small preset, and a sparse-water variant made only with `--config`
  (`docs/sprints/sprint-3.5/sparse-water.json`; with memory: `sparse-water-memory-on.json`). The
  benchmark arena uses the same variant, because its map comes from the run's config.

**Sparse-water variant.** Map generator settings only: `shallowWaterThreshold` −0.08 → −0.22 (no
shallow water from the noise, only ponds and deep-water shores), `islandCoreLift` 0.14 → 0.3 (fewer
inland lakes), ponds smaller (`pondRadius` 2.05 → 1.5) and farther from the spawn centre
(`pondDistanceRatio` 0.72 → 1.3), placed only when a spawn has fewer than 6 drinkable water tiles
within its fairness radius (`targetFairnessWaterTiles` 12 → 6, `minFairnessWaterTiles` 6 → 3).
Measured on seeds 1–40 (scratch script over the generated maps, vision radius 8):

| Map | Spawn-zone tiles with water in sight | Mean distance to water from the spawn zone | Land with water in sight | Arena: in sight / distance | Arena: DRINK-only brain |
|---|---|---|---|---|---|
| Normal Small | 99 % | 2.6 tiles | 99 % | 100 % / 1.7 | 561 |
| Sparse water | 70 % | 6.6 tiles | 85 % | 68 % / 6.8 | 515 (= STAY-only: no clone spawns next to water) |

So on the normal map water is almost never out of sight, and memory can only help with something
else; on the sparse map a third of the spawn zone can't see water and the rest sees it 2.6× farther
away.

**Development runs (memory off only, seeds 1–40; no memory-on run before the bar was fixed).**
They sized the bar and picked the variant. "Late" = mean of a tribe's last three benchmarks.

| Map, generations | Seeds | Gen 1 → late (mean) | Mean ratio (final / gen 1) | Tribes ≥ 1.5× | Hard lock-in | Two halves of 20 seeds differ by (5th–95th pct.) |
|---|---|---|---|---|---|---|
| Normal, 100 | 1–40 | 607 → 1,388 | 2.34 (1–20: 2.41, 21–40: 2.26, as in Sprint 3.4) | 69 / 80 | 0 | −8 % … +9 % |
| First sparse try (spawn ring 10 as well), 100 | 1–40 | 535 → 635 | 1.20 | 10 / 80 | 34 | −10 % … +11 % |
| … same, 300 | 1–20 | 536 → 773 (gen 300) | 1.44 | — | — | — |
| Sparse water (chosen), 100 | 1–20 | 561 → 749 (gen 100) | 1.34 | 12 / 40 | 12 | — |
| Sparse water (chosen), 300 | 1–40 | 546 → 1,035 | 1.92 | 45 / 80 | 9 | −13 % … +15 % |

The first, drier variant (spawn ring 14 → 10 too: water in sight from 53 % of spawn tiles, 7.5
tiles away) was too hard: memory off barely learned even in 300 generations, and with 34 of 80
tribes locked in there would be little left to compare. With the chosen variant memory off still
learns slowly (no plateau at generation 100), so the sparse arms run **300 generations**.

## Acceptance bar (fixed before the held-out run)

Chosen by the user on 2026-11-25, before any held-out seed was run and before memory-on had been
trained on any seed. The plan's "≥ 2 of 3 seeds" would mostly measure luck (Sprint 3.4).

Measured **once** per arm on held-out Small seeds **201–250** (never used before), with the
shipped `DEFAULT_CONFIG` plus only the files named:

```
pnpm train --preset small --seeds 201-250 --generations 100 --out runs/s35-normal-off
pnpm train --preset small --seeds 201-250 --generations 100 --config docs/sprints/sprint-3.5/memory-on.json --out runs/s35-normal-on
pnpm train --preset small --seeds 201-250 --generations 300 --config docs/sprints/sprint-3.5/sparse-water.json --out runs/s35-sparse-off
pnpm train --preset small --seeds 201-250 --generations 300 --config docs/sprints/sprint-3.5/sparse-water-memory-on.json --out runs/s35-sparse-on
```

- **Tribe score** = the mean of its last three benchmark-arena scores in `stats.csv`
  (generations 80/90/100; sparse 280/290/300). Averaging three champions damps the champion
  noise seen in Sprint 3.4 (a single generation-100 champion moved tribes across the bar).
- **Seed score** = mean of its 2 tribes; **arm score** = mean of its 50 seed scores.

Memory passes only if all three hold:

1. **Normal map, not worse:** memory-on arm score ≥ **0.95 ×** memory-off.
2. **Sparse map, better:** memory-on arm score ≥ **1.10 ×** memory-off.
3. **Sparse map, on most seeds:** memory-on's seed score beats memory-off's on **≥ 30 of 50**
   seeds (same seed = same maps).

Why these thresholds: between two memory-off arms of 20 seeds the arm scores differed by −8 … +9 %
(normal) and −13 … +15 % (sparse), 5th–95th percentile of random splits of the development
seeds; with 50 seeds per arm that is about ±6 % and ±9 %. A memory that does nothing would then
fail condition 1 about 7 % of the time and pass condition 2 about 4 % of the time; condition 3
alone (a coin flip per seed) passes 10 % of the time. A real +20 % on the sparse map would pass
condition 2 about 95 % of the time.

**Reported per arm, not blocking:** mean ratio (final generation / generation 1), tribes ≥ 1.5×
generation 1; **hard lock-in** = tribes whose best creature's world fitness stayed below 700 in
each of the last 10 generations (an always-EAT or always-DRINK tribe dies at tick ~530; nobody
finds water); **champion noise** = tribes below 1.5× that are not hard lock-ins, the mean
|final-generation benchmark − tribe score| / tribe score, and the mean spread of the three late
benchmarks.

**If memory passes:** `brain.memoryNeurons` becomes 2 in `DEFAULT_CONFIG` (user's decision, same
day): `SIM_VERSION` 10, golden hashes and the seed-42 regression test re-checked. **If it fails:**
memory stays off (the switch stays), and the retro says why.

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
