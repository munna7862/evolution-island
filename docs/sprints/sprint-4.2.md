# Sprint 4.2 — Balance pass

- **Phase:** 4 — Tribes & Competition (`docs/phases/phase-4.md`)
- **Branch:** `sprint-4.2`
- **Personas:** Game Designer (tribe score, territory, combat numbers, battle royale), ML / Evolution
  Engineer (sweeps, lock-in, champion noise), SDET (analysis tool, acceptance measurements,
  exploit tests), Simulation Architect (rule changes, determinism, `SIM_VERSION`)

## Goal

Balance Medium so that no start slot and no degenerate strategy wins by default (plan §4 Sprint
4.2): population caps, fair spawns, hotspots, fitness and tribe-score weights. Plan bar: over 10
seeds × 200 generations on Medium, no start slot has the highest tribe score at generation 200 in
more than 5 of the 10 seeds; in battle royale ≥ 2 tribes are alive at generation 20 in ≥ 7 seeds;
champions don't show a degenerate action mix (e.g. > 80 % `STAY`).

## Starting point (`main` at `5fe89b5`, `SIM_VERSION` 11)

Sprint 4.1 made combat, sharing and territory work; kills are rare (Medium ≤ 0.4 per generation)
and generation-end territory is tiny (Medium 0.3–1.4 % for all tribes together). Known leads:

1. **Tribe score is absolute** (survivors + food), so a tribe at `popCap` out-scores equally good
   smaller tribes and tends to stay at the cap (Sprint 3.2 review: Medium 100/25/25/25 for many
   generations).
2. **Population drop:** when one tribe alone survives on Medium, the three extinct tribes return at
   25 and the leader is capped at 100: 175 of 200 (plan §2.5, accepted until this sprint).
3. **Battle royale ends at generation 1** from scratch (everyone dies out in generation 1); on
   Medium after ~100 generations the weaker tribes still die out completely in about a third of
   generations (Sprint 4.1 seeds 101–103). The plan's "≥ 2 tribes alive at generation 20" can't
   hold without a grace period (Sprint 3.2 review).
4. **Territory at generation end** mostly counts who is still alive; if it gets a tribe-score
   weight, average it over the generation (Sprint 4.1 retro and review).
5. **Share inequality:** tuning must keep `shareNeedRatio·max + shareAmount·shareEfficiency ≤
   shareKeepRatio·max + shareAmount`, or energy can flow back between allies (Sprint 4.1 review).
6. Lock-in and champion noise: re-measure with memory and combat on (Sprints 3.4/3.5).

## Approach

1. **Measure first.** A committed `pnpm analyze` tool computes the bar from run folders: each run's
   start-slot winner (highest tribe score at the last generation), tribes alive (battle royale),
   each tribe's late score (mean of its last three benchmarks), hard lock-in, and the action mix of
   each tribe's best hall-of-fame champion in the benchmark arena. Baseline on Medium development
   seeds 1–20 × 200 generations.
2. **Change what the baseline shows is broken**, one lever at a time, each A/B on development seeds
   (never the held-out ones), recorded below with its reason and result.
3. **Bar before held-out run:** propose a multi-seed version of the plan's 10-seed bar (sized from
   measured noise, as in Sprint 3.5) and the battle-royale interpretation to the user, fix it here
   and in the plan, then run held-out seeds once.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file | Written before coding |
| 2 | `runBenchmarkDetailed` (score + action counts of the clones) in sim-core | Unit tests: counts add up to living clone-ticks; score equals `runBenchmark` |
| 3 | `pnpm analyze --runs <dir>`: slot winners, tribes alive, late scores, lock-in, champion action mix; stored benchmark scores reproduced | Unit tests on a tiny trained run |
| 4 | Baseline on Medium seeds 1–20 × 200 generations (normal and battle royale) | Numbers below |
| 5 | Balance changes (config and/or rules, each behind config where it is a rule), each with tests and exploit tests where it touches fitness | Sweeps recorded below |
| 6 | Bar proposed, chosen by the user, committed here and in the plan before the held-out run | — |
| 7 | Held-out run, once | Every seed's numbers below |
| 8 | `SIM_VERSION` bump if rules or defaults change; golden hashes; docs, retro | All checks green |

## Definition of done

- Bar met on the held-out seeds (or the retro says why not and what was left), every seed's numbers
  recorded; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`,
  `pnpm test:e2e` green.
- Every changed fitness or tribe-score term keeps an exploit test; the seed-42 test still passes.

## Out of scope

- Signals — Sprint 4.3. Viewer changes — Phase 6. Large/Huge balance — Phase 7.

---

## Baseline (`SIM_VERSION` 11 defaults, Medium seeds 1–20 × 200 generations)

`pnpm train --preset medium --seeds 1-20 --generations 200` (14.5 minutes), then
`pnpm analyze --runs <dir>`; every one of the 80 champions' stored benchmark scores was reproduced.

| Measure | Result |
|---|---|
| Start-slot wins (highest tribe score at generation 200) | slot 0: 3, slot 1: 4, **slot 2: 9**, slot 3: 4 |
| Mean tribe size by slot, generations 101–200 | 50.0 / 51.4 / 52.9 / 45.8 |
| Champions above 80 % `STAY` | **0 of 80** (max 59 %) |
| Mean champion action mix | moves 8 %, `STAY` 25 %, `EAT` 45 %, `DRINK` 21 %, `SHARE` 0 % |
| Late score (mean of last 3 benchmarks) | 2,123; mean ratio to generation 1: 3.58 |
| Hard lock-in | 0 of 80 tribes |
| Generations with total population < 200 | gens 1–20: 89 of 400 (mean 194.4); 21–100: 302 of 1,600 (195.3); 101–200: 0 of 2,000 |
| Generations in which a tribe died out (101–200) | slot 0 11 %, slot 1 7 %, slot 2 5 %, slot 3 8 %; tribes of ≥ 60: never |

- **Start slots look fair.** Spawn angles are random per seed (`baseTurn` from the map stream), so
  slot 2 has no fixed place on the map, and tribe sizes by slot are close. A slot winning ≥ 9 of
  20 happens by chance in about 15 % of 20-seed samples (four slots, p = 0.25 each).
- **The winner is the biggest tribe.** Tribe score is absolute, so the tribe at or near the cap
  (84–100 at generation 200) wins; the others sit near 25. This is the "rich get richer" lead; it
  doesn't favour a slot, and the bar doesn't ask for equal sizes, so it stays (see the retro).
- **No degenerate champions.** The arena has one tribe, so it can't show `ATTACK`; in the world
  kills stay rare (Sprint 4.1).
- **Battle royale from scratch ends in generation 1** (every tribe dies out then). After 100
  generations tribes rarely die out: in 19 of 20 seeds at least 2 tribes had survivors in every one
  of generations 101–120 (20 of 20 for 151–170 and 181–200), a static estimate.
- **Population drop:** only in the first 100 generations (about 19 % of them), from 200 to a mean
  of ~195.

## Changes (each from the baseline above)

1. **`evolution.battleRoyaleFromGeneration`** (default 100): in battle royale, a generation's end
   eliminates extinct tribes only from this generation on; before it, extinct tribes respawn and
   generations run their full length, as in normal mode. Test: no elimination before it (a doomed
   tribe respawns, the generation isn't cut short), elimination from it on.
2. **No population drop:** `allocateTribeSizes` gives places the scoring tribes can't take (all at
   `popCap`) to the extinct tribes, one at a time in index order, up to `popCap`. One tribe alone
   surviving on Medium now gives 100 / 34 / 33 / 33 instead of 100 / 25 / 25 / 25. The property
   test now also checks that an extinct tribe only grows once every scoring tribe is at the cap.
3. **Territory averaged over the generation:** `World.territoryAverage` (sum of the recounts ÷
   recounts this generation, in the world hash); the tribe outcome and `stats.csv` use it. The
   tribe-score weight stays 0 (retro).

`SIM_VERSION` 11 → 12; golden hashes re-recorded (map hash and the forward-pass digest unchanged).

**Re-check on development seeds 1–20** (after the changes, `SIM_VERSION` 12): start-slot wins
4 / 8 / 6 / 2; total population exactly 200 in all 4,000 generations; no champion above 80 %
`STAY` (max 64 %); late score 2,165 (ratio 3.66; baseline 2,123 / 3.58); no hard lock-in; mean
territory per tribe at generation 200 (now the generation's average) 1.71 %. Battle royale
(`docs/sprints/sprint-4.2/battle-royale.json`, 120 generations, eliminations from 100): ≥ 2 tribes
alive at generation 120 in **20 of 20** seeds (2 tribes in 9, 3 in 6, 4 in 5).

## Acceptance bar (fixed before the held-out run)

Chosen by the user on 2026-11-25 before any held-out seed was run. Held-out Medium seeds
**301–340** (never used), each run **once**:

```
pnpm train --preset medium --seeds 301-340 --generations 200 --out runs/s42-heldout
pnpm train --preset medium --seeds 301-340 --generations 120 --config docs/sprints/sprint-4.2/battle-royale.json --out runs/s42-heldout-br
pnpm analyze --runs runs/s42-heldout
pnpm analyze --runs runs/s42-heldout-br
```

The bar passes only if all three hold:

1. **Start slots:** no slot has the highest tribe score at generation 200 in more than **16 of
   40** seeds (40 %). A fair game (each slot 25 %) fails this about 4 % of the time; a slot that
   truly wins half the time passes only about 13 %. (Plan: > 5 of 10, which a fair game fails
   ~8 % of the time and a 50 % slot passes ~62 %.)
2. **Battle royale:** with eliminations from generation 100 (the default grace period), ≥ 2 tribes
   alive at generation 120 in **≥ 28 of 40** seeds (70 %, the plan's 7 of 10). From scratch every
   tribe dies out in generation 1, so the plan's "alive at generation 20" is read as 20 generations
   after eliminations start.
3. **Champions:** none of the 160 tribes' best hall-of-fame champions (at generation 200) above
   **80 % `STAY`** in the benchmark arena.

Reported, not blocking: late score and ratio, hard lock-in, action mixes, kills, territory,
population.
