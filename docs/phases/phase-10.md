# Phase 10 — Publish (optional)

> Source of truth: `docs/master-plan.md` §4 (Phase 10). Phase 9 (LLM chiefs) was skipped for now.

## Goal

- Deploy the viewer as a static site (GitHub Pages) with pre-trained runs.
- Shareable seed links: `?preset=large&seed=1234&v=<simVersion>`.
- ✅ The deployed site plays a pre-trained run, and a seed link reproduces the same map on another machine.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 10.1 | Static site, featured runs, share links | Relative-path static build, `pnpm featured`, a "Trained" menu and `?run=` links, `v=` in links with a version note, Copy link, Pages workflow, README |

## Exit criteria

1. The deployed site plays a pre-trained run. Checked by e2e on the built site, and on the live site after the first deploy.
2. A seed link makes the same map as Node does: e2e compares the browser's map hash with `createWorld` in Node.

## Architecture decisions taken in this phase

1. **Featured runs are static files next to the site** (`packages/viewer/public/runs`). `pnpm featured` copies the first, last and three in-between checkpoints of each run, with only their hall-of-fame genomes (about 1 MB for two runs), and writes a manifest. The viewer fetches files only when a checkpoint plays.
2. **A test fails when they go stale.** `published-runs.test.ts` requires this build's simVersion and default config, and loads every published generation. After a rules or config change, retrain and run `pnpm featured` again.
3. **Links describe what plays.** The address bar always holds preset, seed and `v` (plus `run` and `gen` for a featured run's saved generation), so copying it shares the view. The tribe filter is not in the link. A link from another simVersion still opens, with a note that the world may differ.
4. **GitHub Pages via Actions** (`.github/workflows/pages.yml`): every push to `main` builds the viewer and deploys it. The build uses relative URLs (`base: './'`), so the site works under `/<repo>/`.
