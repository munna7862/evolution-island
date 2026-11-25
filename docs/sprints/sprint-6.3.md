# Sprint 6.3 — Family tree & events feed

- **Phase:** 6 — Spectator Experience (`docs/phases/phase-6.md`)
- **Branch:** `sprint-6.3`
- **Personas:** ML / Evolution Engineer (parentage), Frontend / Rendering Dev, SDET

## Goal

Plan §4 Sprint 6.3: a lineage tree for a tribe's champions; an event feed ("Blue tribe went
extinct", "Red reached 40% territory", "New fitness record"). ✅ Playwright tests for dashboard,
inspector and feed.

## Design

- **Parentage at breeding** (sim-core): `breedGenomes` / `respawnGenomes` take an optional
  `parentsOut` and record, for each genome, the candidate indices it came from (one for an elite
  or a copy, two for a crossover, none for a random genome) and whether they were the hall of fame.
  `pickParentIndex` makes the same draws as `pickParent`: golden hashes are unchanged.
- **Lineage** (`EvolutionRun`): for each generation, every creature's parents (ids in the
  generation before), rank and fitness at its end, kept for the last `LINEAGE_GENERATIONS` (30)
  generations — "lineage is kept only for recent ancestors, so memory doesn't grow" (plan §3.5).
  Not run state, not hashed; a resumed run starts a new tree. `championLineage(tribe, depth)`
  returns the last finished generation's champion with its ancestors; shared ancestors are
  memoised (without that a 30-generation tree doubles per level and ran out of memory).
- **Events feed** (viewer `DashboardData`): from each finished generation and the records so far —
  a tribe dying out after it had survivors, being eliminated, first reaching 1 / 2 / 5 / 10 / 20 /
  40 % territory, a tribe's benchmark record, a fitness record of all tribes, a new leader by tribe
  score; newest first, the last 100.
- **Dashboard:** Events and "Family tree of <tribe>'s champion" sections (the leader by default;
  clicking a row shows that tribe and inspects its champion); the tree lists the champion and its
  ancestors generation by generation (rank in brackets, hall-of-fame returns dashed).
- No simulation change (`SIM_VERSION` 13).

## What was done

As designed. **Tests:** unit — `lineage.test.ts` (4: parentage without changing a draw, elites /
crossovers / copies / random, hall-of-fame returns, a champion traced through real parents with
ranks and fitness, only the last 30 generations kept), feed events (1: each kind, no repeats, newest
first), worker lineage request = Node's `championLineage`; e2e — the dashboard test now also checks,
after two generation ends, that the feed equals the events Node's reports give and that the family
tree shows the leader's champion and exactly its parents. Playwright covers dashboard (6.1),
inspector (6.2) and feed + tree (6.3).

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (406 in 52 files), `pnpm test:browser`
(30), `pnpm build`, `pnpm test:e2e` (15) pass locally.

## Retro

**Went well**
- Recording parentage as an optional output of breeding kept the GA's draws untouched (golden
  hashes prove it), so the family tree could be added without a `SIM_VERSION` bump.

**Surprises / learnings**
- A family tree is a DAG: elites and popular parents appear under many children. Building it as a
  plain tree exhausted memory at depth 30; memoising subtrees fixed it.
- This machine ran at 90–99 % CPU from another program during the sprint; timing-sensitive tests
  (Vitest's 5 s default, some e2e waits) failed now and then and passed on re-runs and in CI.

## Reviews (2026-11-25)

Two passes in the implementing session (the app does not let it start sessions from an automated
turn). **Review 1 — correctness.** Checked: parent ids map candidate indices through that
generation's ranking (the candidates are the ranked genomes); hall-of-fame returns have no
parents and are marked; founders (generation 1, a checkpoint or a resumed run) have none; ranks
and fitness are filled at the generation's end before breeding; memoised subtrees keep the tree
small; the feed fires a benchmark record only after a tribe's first benchmark and extinction only
after a generation with survivors. Found: nothing to fix (the memory blow-up was found and fixed
during the sprint). **Review 2 — docs/tests.** Counts and texts agree; Phase 6 exit criteria met
(dashboard, inspector, feed covered by Playwright).
