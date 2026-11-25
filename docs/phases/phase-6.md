# Phase 6 — Spectator Experience

> Source of truth: `docs/master-plan.md` §4 (Phase 6), §1 (watching is the fun), §3.3 (viewer
> only reads snapshots and on-demand queries).

## Goal

Reach **Milestone M5 — "Spectator ready"**: a dashboard that tells the story of a run as it
evolves, an inspector to look inside one creature's head, and the history (family trees, events)
that makes runs worth watching.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 6.1 | Live dashboard | Leaderboard (population, territory %, kills, average fitness, benchmark score), generation counter, charts of fitness, benchmark and population per tribe over generations |
| 6.2 | Creature inspector & follow-cam | Click a creature → live stats, sensors, action, memory (and calls), brain activations from the worker; follow-cam |
| 6.3 | Family tree & events feed | Champions' lineage; feed of notable events |

## Exit criteria (Phase 6 is done when)

1. Dashboard values update at each generation end (Playwright) — 6.1.
2. Clicking a creature opens the inspector with live values; follow-cam keeps it on screen — 6.2.
3. Playwright tests for dashboard, inspector and feed — 6.3.

## Architecture decisions taken in this phase

1. **Generation reports come from the worker (Sprint 6.1).** When an `EvolutionRun` generation
   ends, the worker sends every tribe's stats (`generationStats`); the viewer keeps them in
   `DashboardData` (pure, unit tested) and draws the leaderboard and charts. Random mode has no
   generations, so the dashboard is hidden there.
2. **Charts are drawn on a canvas by the viewer itself (Sprint 6.1)**, not with uPlot (plan §3.1):
   three small line charts need ~40 lines of code, and a new dependency would have meant another
   download for little gain. Revisit if charts need zoom or tooltips.
