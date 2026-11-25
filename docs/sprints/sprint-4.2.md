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
