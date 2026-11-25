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
  generations tribes rarely die out: in 19 of 20 seeds at least 2 tribes never died out in generations
  101–120 (20 of 20 for 151–170 and 181–200), a static estimate.
- **Population drop:** only in the first 100 generations (about 19 % of them), from 200 to a mean
  of ~195.

## Changes (each from the baseline above)

1. **`evolution.battleRoyaleFromGeneration`** (default 100): in battle royale, a generation's end
   eliminates extinct tribes only from this generation on; before it, extinct tribes respawn and
   generations run their full length, as in normal mode. Test: no elimination before it (a doomed
   tribe respawns, the generation isn't cut short), elimination from it on.
2. **No population drop:** `allocateTribeSizes` gives places the scoring tribes can't take (all at
   `popCap`) to the extinct tribes (and, since the review, tribes that scored nothing), one at a
   time in index order, up to `popCap`. One tribe alone
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
alive at generation 120 in **20 of 20** seeds (2 tribes in 10, 3 in 6, 4 in 4).

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


## Acceptance (held-out seeds 301–340, run once)

The four commands of the bar, after `606c97f` (`SIM_VERSION` 12, default config
`hashConfig` of this build). Normal runs: 52 minutes; battle royale: 19 minutes. `pnpm analyze`
reproduced all 320 stored champion benchmark scores before measuring their action mix.

| Condition | Needed | Result | |
|---|---|---|---|
| 1. Most start-slot wins (normal, generation 200) | ≤ 16 of 40 | slot 0: **15**, slot 1: 7, slot 2: 13, slot 3: 5 | pass |
| 2. Battle royale: seeds with ≥ 2 tribes alive at generation 120 | ≥ 28 of 40 | **38 of 40** | pass |
| 3. Best champions above 80 % `STAY` (normal runs) | 0 of 160 | **0** (max 70 %, median 18 %) | pass |

**The bar is met.** Condition 1 has the least room (15 vs 16).

Reported, not blocking (normal runs): late score 2,163, mean ratio to generation 1 3.53, no hard
lock-in (0 of 160), mean champion mix moves 10 % / `STAY` 22 % / `EAT` 48 % / `DRINK` 21 %,
total population 200 in every generation. Kills grow with training: 1,890 in all, 0.24 per
generation per seed overall but 0.72 in generations 191–200. Battle-royale runs: champions max
72 % `STAY`, late score 1,697 (ratio 2.77).

Per seed: winning slot (normal, generation 200), tribes alive at generation 120 in battle royale
and the battle royale's highest tribe score's slot:

| Seed | Normal: winner | Battle royale: alive | Battle royale: top slot |
|---|---|---|---|
| 301 | 2 | 3 | 2 |
| 302 | 3 | 2 | 3 |
| 303 | 0 | 2 | 0 |
| 304 | 2 | 4 | 2 |
| 305 | 3 | 3 | 2 |
| 306 | 0 | 2 | 3 |
| 307 | 2 | 2 | 2 |
| 308 | 2 | 3 | 2 |
| 309 | 2 | 2 | 1 |
| 310 | 0 | 2 | 0 |
| 311 | 0 | 4 | 3 |
| 312 | 3 | 1 | 3 |
| 313 | 0 | 2 | 0 |
| 314 | 2 | 2 | 2 |
| 315 | 0 | 3 | 2 |
| 316 | 0 | 4 | 0 |
| 317 | 0 | 2 | 0 |
| 318 | 2 | 1 | 2 |
| 319 | 3 | 3 | 3 |
| 320 | 2 | 2 | 2 |
| 321 | 0 | 2 | 0 |
| 322 | 1 | 3 | 1 |
| 323 | 0 | 3 | 0 |
| 324 | 1 | 3 | 2 |
| 325 | 0 | 3 | 0 |
| 326 | 0 | 3 | 1 |
| 327 | 1 | 2 | 2 |
| 328 | 2 | 2 | 2 |
| 329 | 0 | 3 | 2 |
| 330 | 0 | 2 | 2 |
| 331 | 1 | 2 | 1 |
| 332 | 1 | 3 | 1 |
| 333 | 1 | 3 | 2 |
| 334 | 3 | 2 | 3 |
| 335 | 2 | 4 | 2 |
| 336 | 0 | 2 | 0 |
| 337 | 2 | 2 | 2 |
| 338 | 2 | 2 | 2 |
| 339 | 2 | 2 | 2 |
| 340 | 1 | 2 | 2 |

**A lead, not part of the bar:** in the battle-royale runs slot 2 had the highest tribe score in
20 of 40 seeds (normal runs: 13 of 40; development seeds: 9 of 20, then 6 of 20). Spawn angles are
random per seed and no rule treats tribe 2 differently, and the normal-mode condition passed, but
over all 140 runs of this sprint (development battle royale: 3 of 20) slot 2 led 51 times, 36 %,
against an expected 25 %. Worth a dedicated check (e.g. 100 seeds, tribe ids permuted against spawn zones) before Phase 6 shows
leaderboards.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (345 tests in 43 files),
`pnpm test:browser` (8), `pnpm build`, `pnpm test:e2e` (11) pass locally.

## Retro

**Went well**
- `pnpm analyze` measured the whole bar the same way on development and held-out seeds, and
  re-ran every champion first to prove the stored scores (320 of 320 reproduced).
- The baseline showed what was actually broken (battle royale ending at generation 1, a shrinking
  population early on, territory read at generation end) and what wasn't (degenerate champions,
  lock-in), so three small rule changes were enough.

**Surprises / learnings**
- The plan's 10-seed slot rule would have let a slot that wins half the time pass ~62 % of the
  time; 40 seeds and a 40 % threshold catch it ~87 % of the time.
- Kills, rare at generation 100 (Sprint 4.1), triple by generation 200: tribes start to meet.
- Medium training at 200 generations is slow on this machine (52 minutes for 40 seeds): keep
  held-out runs to what the bar needs.

**Left as is (with reasons)**
- Tribe score stays absolute: the leader sits near the cap, but no slot benefits and the bar
  doesn't ask for equal sizes; a per-member score would change what "winning" means.
- Territory weight stays 0: even averaged over the generation, tribes hold 1–2 % of the island;
  weighting it now would mostly reward size. Revisit when territory is shown (Phase 6).
- Combat numbers unchanged: kills are only now becoming common.

**Notes for Sprint 4.3**
- Reuse `pnpm analyze` and the noise-sized bar recipe; the 4.2 criteria to re-check with
  signals are the three conditions above.
- Check the slot-2 lead above if it shows again.

## Review (2026-11-25)

Fresh-session review of PR #15 (`git diff 5fe89b5...sprint-4.2`).

**Checked, no change needed**
- Rules match plan §2.5/§2.6 and `phase-4.md`: `eliminates` (battle royale and generation ≥
  `battleRoyaleFromGeneration`) gates both the early end of a generation and elimination; the
  boundary is tested (from 3: generations 1–2 respawn and run 30 ticks, generation 3 eliminates).
- Determinism: territory sum and recount count use only + and /, are summed in tribe order, are in
  the world hash and reset at generation start; `battleRoyaleFromGeneration` is in `config.ts`,
  `hashConfig` and the whole-number list in `config-override.ts`.
- `runBenchmarkDetailed`: counts the resolved action of every clone alive at a tick's start (in a
  one-tribe arena nobody dies before acting), and the STAY test pins counts = living clone-ticks.
- `pnpm analyze` computes the bar as defined: winner = highest tribe score at the last generation,
  alive = a row there with a next size > 0 (eliminated tribes have none), late score = last three
  benchmarks, lock-in = last 10 generations below 700, STAY share over living clone-ticks.
- Every held-out number recomputed from `stats.csv` and `analysis.json` independently of
  `pnpm analyze`: slot wins 15/7/13/5, the per-seed table (all 40 rows, both columns), 38 of 40,
  max STAY 70 % / median 18 % (battle royale 72 %), late 2,163 / 3.53 (1,697 / 2.77), 0 lock-ins,
  population 200 in all 8,000 generations, 1,890 kills (0.24, 0.72 in 191–200). Baseline and
  development numbers too (slot wins, sizes by slot 50.0/51.4/52.9/45.8, extinction by slot
  11/7/5/8 %, population 89/302/0 below 200, 2,123/3.58, 2,165/3.66, territory 1.71 %).

**Found and fixed**
1. **Population could still drop when every tribe died out.** Then every tribe shares by score,
   and one that gathered no food scores 0 and is held at `minTribeSize`; the leftover rule only
   gave places to `min` (extinct-with-survivors-elsewhere) tribes, so `[900, 0, 0, 0]` gave
   100/25/25/25 = 175. Tribes that scored nothing now take leftover places too (new test; the
   property test's ceiling and "held at min only grows once every scorer is capped" check now
   cover them). Never happened in this sprint's runs (population 200 everywhere), so golden
   hashes are unchanged.
2. **`pnpm analyze` tests couldn't fail for the wrong window.** The trained-run test had exactly
   three benchmarks and every row below fitness 700, so "mean of all benchmarks" or "lock-in over
   all rows" passed it; winner ties were never exercised, and the tie-break relied on checkpoint
   order. `analyzeTribe` and `pickWinner` are now exported with synthetic-row tests (last three
   of six benchmarks, a 900 just outside / inside the 10-generation window, eliminated-before
   tribes, ties in reverse order); `pickWinner` sorts by id itself.
3. **Docs.** Held-out champion mix: moves are 10 % (2.4 % per direction), not 8 %. Development
   battle royale: 2 tribes alive in 10 seeds and 4 in 4, not 9 and 5. Slot-2 lead: "~40 % of all
   120 runs" left out the development battle royale (3 of 20); over all 140 runs it is 51, 36 %
   (here and in the plan revision note). Baseline "19 of 20 seeds" counts tribes that never died
   out in 101–120 (per generation it is 20 of 20); reworded. Plan §2.5 and `phase-4.md` decision
   7 name the zero-score case.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (350 tests in 43 files),
`pnpm test:browser` (8), `pnpm build`, `pnpm test:e2e` (11) pass locally. `SIM_VERSION` stays 12 (unmerged); golden hashes
unchanged.

## Review 2 (2026-11-25)

A second pass over `git diff 5fe89b5...sprint-4.2` after review 1's `b2471fe` (done in the
implementing session: the app does not let it start sessions from an automated turn).

**Checked, no change needed**
- `allocateTribeSizes` after review 1: the leftover loop gives places only while some held-at-min
  tribe is below `max`, in index order, and `left` never goes negative; with no scorer at all every
  tribe shares evenly first, so the zero-score branch only applies when `anyScore` holds. The
  property test's ceiling and "held at min grows only once every scorer is capped" check cover it.
- Battle-royale grace: `eliminates(generation)` gates both the early end (`isGenerationOver`, on
  the current generation) and elimination at the end; when a battle royale finishes,
  `endGeneration` returns before sizes are reassigned, and `statsRowsFor` writes `nextSize` 0 only
  for eliminated tribes, which is what `pnpm analyze` reads as "not alive".
- `runBenchmarkDetailed`: every clone alive at a tick's start has its `lastAction` set in that
  tick's Phase B (no deaths before acting in a one-tribe arena), so the counts are exact.

**Found and fixed:** nothing.
