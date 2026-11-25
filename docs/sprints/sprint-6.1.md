# Sprint 6.1 — Live dashboard

- **Phase:** 6 — Spectator Experience (`docs/phases/phase-6.md`)
- **Branch:** `sprint-6.1`
- **Personas:** Frontend / Rendering Dev (dashboard, charts), SDET (Playwright), Product Owner
  ("is it fun to watch?")

## Goal

Plan §4 Sprint 6.1: leaderboard (population, territory %, kills, average fitness, benchmark
score), generation counter, graphs of fitness, benchmark score and population per tribe over
generations. ✅ Playwright: dashboard values update at each generation end.

## Design

- **Worker → viewer:** at each generation end of an `EvolutionRun` (watching a saved generation or
  a replay) the worker sends `generationStats` with every tribe's line of that generation
  (population, survivors, average and best fitness, territory %, kills, tribe score, benchmark
  score), and at start the run's earlier generations (a replay's history).
- **`DashboardData`** (pure): the last finished generation's leaderboard, best tribe score first,
  each tribe's latest benchmark score carried forward (benchmarks run every 10 generations), and
  per-tribe series for the charts. **Population is live** (from snapshots), the other columns are
  per finished generation.
- **Panel** top right over the map (the HUD stays top left), shown while watching a run or replay,
  hidden in random mode (no generations). Three canvas line charts (average fitness, benchmark —
  joined across non-benchmark generations — and population), one line per tribe in its colour.
- **Charts without uPlot** (plan §3.1 named it): drawn by `chartPaths` + canvas, no new
  dependency; recorded in `phase-6.md` and the plan.
- No simulation change (`SIM_VERSION` 13).

## What was done

As designed. Debug hook: `dashboard` (generation + leaderboard rows).

**Tests:** unit (395 in 50 files, +5) — `dashboard.test.ts` (4: ranking, benchmark carried forward, repeats ignored,
series with nulls, chart scaling, broken vs joined lines) and a worker test (the report sent at a
generation end equals Node's history for it); e2e — load a run, play two generation ends, and the
dashboard shows generation 3 then 4 with exactly Node's tribe score, kills, average fitness and
territory, rows ordered by tribe score.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`,
`pnpm test:e2e` (14) pass locally.

## Retro

**Went well**
- `EvolutionRun` already kept every generation's stats; the dashboard only had to carry them out
  of the worker, and the e2e could compare them with a Node run of the same checkpoint exactly.

**Surprises / learnings**
- Benchmarks run every 10 generations, so a benchmark chart drawn with gaps is all dots; it joins
  the points instead, and the leaderboard carries the latest score forward.

**Notes for Sprint 6.2**
- The inspector can reuse the same worker request/response pattern (`requestHash`, `exportReplay`).

## Reviews (2026-11-25)

Two passes in the implementing session (the app does not let it start sessions from an automated
turn). **Review 1 — behaviour:** the panel shows only while a run or replay plays; a replay's
earlier generations appear at once; an eliminated tribe's last row is struck through; going back
to a random world hides and clears it; the live population column follows every snapshot. Nothing
to fix. **Review 2 — docs/tests:** the unit-test count was wrong (4 dashboard tests, not 5; +5 with
the worker test, 395 in all); fixed.
