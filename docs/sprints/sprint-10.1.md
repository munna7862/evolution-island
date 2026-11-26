# Sprint 10.1 — Static site, featured runs, share links

- **Phase:** 10 — Publish (optional) (`docs/phases/phase-10.md`)
- **Branch:** `phase-10`
- **Personas:** Frontend / Rendering Dev, DevOps, SDET

## Goal

Plan §4 Phase 10:
- Deploy the viewer as a static site (GitHub Pages / Vercel) with pre-trained runs.
- Shareable seed links `?preset=large&seed=1234&v=<simVersion>`.
- ✅ The deployed site plays a pre-trained run, and a seed link reproduces the same map on another machine.

## Design

- **Featured runs:**
  - `shared/featured-runs.ts`: the manifest format, with safe run names and relative file paths only, plus `pickFeaturedGenerations` (first, last, nearest ¼ / ½ / ¾, ties going to the earlier generation).
  - `trainer/featured.ts`: `pnpm featured <run>... [--out]`. It refuses runs from another simVersion or a non-default config.
  - `viewer/featured.ts`: fetches the manifest and run files from `runs/` next to the page.
- **Viewer:**
  - A **Trained** menu, there from the start (disabled while loading, fixed width), so the toolbar never shifts the map. It says when the site has no runs or they are outdated.
  - `?run=<name>` plays a featured run; **Copy link** copies the address.
  - `share-link.ts`: the address bar always carries preset, seed, `v` and `run`. A link from another simVersion opens with a note.
- **Site:**
  - `vite.config.ts` has `base: './'`.
  - `.github/workflows/pages.yml` builds and deploys on every push to `main`, using `configure-pages` v6, `upload-pages-artifact` v5 and `deploy-pages` v5.
  - The featured runs folder is exempt from the `runs/` git-ignore rule and from Prettier.
- **Published runs:**
  - Medium seed 42, 300 generations: arena scores went from 542 / 504 / 1,032 / 624 to 2,034 / 2,029 / 3,549 / 2,298.
  - Small seed 42, 100 generations.
  - Both trained with this build's defaults: 1.1 MB in 135 files.
- **README.md:** what the project is, the live site, quick start, commands, share links and docs.

## What was done

As designed.

**Tests:**
- `featured-runs.test.ts` (4): round trip; unsafe names and paths (`..`, absolute, backslashes) and duplicates refused; playability; generation picks.
- `featured.test.ts` in the trainer (3): copies and the manifest from an in-memory file system, the out folder emptied, stats left out; refuses stale runs and name clashes; link-safe names.
- `share-link.test.ts` (3) and the viewer's `featured.test.ts` (3): parameters, URLs under a sub-path, lazy fetches, no manifest.
- `published-runs.test.ts`: the published runs fit this build, and every published generation loads.
- e2e `publish.spec.ts`:
  - The built site lists the featured runs and plays one; its link (`run`, `v`) plays the same run and generation after a reload.
  - A seed link's map hash equals Node's `createWorld` hash.
  - A link from an older version shows the note.

**Verification:**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (460 in 61 files) and `pnpm build` pass locally.
- `pnpm test:e2e` passes (18, with 2 perf tests skipped). The built site's asset URLs are relative.
