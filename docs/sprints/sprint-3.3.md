# Sprint 3.3 — Headless trainer CLI

- **Phase:** 3 — Brains & Evolution (`docs/phases/phase-3.md`)
- **Branch:** `sprint-3.3`
- **Personas:** Simulation Architect (run files, determinism of saved runs), ML / Evolution
  Engineer (what a checkpoint holds, starting a run from one), Frontend / Rendering Dev (loading a
  run folder in the viewer, worker wiring), SDET (CLI tests, Playwright load-and-play test,
  throughput measurements)

## Goal

Hundreds of generations, fast and headless, so Sprint 3.4 can tune (plan §4 Sprint 3.3, §3.6):
`pnpm train` runs `EvolutionRun` in Node, several seeds in parallel on `worker_threads`, and
saves each tribe's hall-of-fame genomes plus generation stats as it goes. The viewer loads a
saved generation from a run folder (file picker or drag-and-drop) and plays it.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | `sim-core`: `EvolutionRun` can start from given genomes — `start: { generation, tribes: [{ tribeId, alive, genomes, hallOfFame }] }` — instead of random generation-1 genomes | Unit tests: given genomes are spawned in order, sizes and hall of fame are taken over, no `rng.evolution` draw, bad input refused, evolution continues from there. Default (random) start unchanged: golden hashes unchanged, no `SIM_VERSION` bump |
| 2 | `shared/run-files.ts`: run manifest (`run.json`), checkpoint (`checkpoint.json`) and stats formats; parse + validate (like `genome-file.ts`); `checkpointStart()` turns a checkpoint + its genome files into an `EvolutionRun` start (each tribe's creatures cycle through its hall of fame, best first) | Round-trip and refusal tests (malformed, other `simVersion`, other config hash, missing genome file) |
| 3 | Trainer: `trainSeed()` runs one seed for N generations and writes the run folder: `run.json`, `stats.json`, `stats.csv`, and `checkpoints/gen-NNNN/` (`checkpoint.json` + one genome file per hall-of-fame entry, `tribe-<id>-hof-<rank>.genome.json`) at generation 1, every `--save-every` generations and at the end | Files written on that schedule; same seed → byte-identical checkpoints and stats; an existing run is not overwritten without `--force` |
| 4 | CLI: `pnpm train --preset medium --seed 42 --generations 500 --out runs/medium-42/`; `--seeds 1-10` (lists and ranges) runs seeds in parallel on `worker_threads` (`--workers`, default CPU count − 1), each in `<out>/<preset>-<seed>/`, plus `summary.json`/`summary.csv`; progress per checkpoint; `--help`; exit codes 0 / 1 (a seed failed) / 2 (usage) | Unit tests for argument parsing, the worker pool (concurrency limit, result order, one failing seed doesn't stop the rest) and `main()` for single and multiple seeds; the real `worker_threads` path runs in the Playwright job (built CLI, two seeds) |
| 5 | Viewer: "Load run…" (folder picker) and drag-and-drop of a run or checkpoint folder; generation select ("Gen 100"); the worker plays the checkpoint with an `EvolutionRun` (evolution continues after it); incompatible files show a message instead of breaking the viewer; debug hook reports the loaded run | Playwright: a run made by the CLI is loaded via the picker and via drop; the browser's world hash at tick N equals Node's for the same checkpoint (so the viewer plays exactly those genomes); a wrong-version file is refused with a message |
| 6 | §3.6 targets measured: 500 generations on Small and Medium (seed 42), and a parallel multi-seed run | Small > 2,000 ticks/s (≈ 6 min for 500 generations), Medium > 1,000 ticks/s (≈ 17 min); numbers recorded below |
| 7 | Docs: this file, `phase-3.md` decisions, plan note if a decision changes | — |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`, `pnpm test:e2e` pass
  locally and in CI.
- Every new rule has a unit test (`CLAUDE.md`).

## Out of scope

- Resuming a killed run, a run browser, migrating old files — Sprint 5.1 (a killed run already
  leaves a consistent folder up to its last checkpoint).
- Replays (exact re-run of a saved generation with its RNG state) — Sprint 5.2. The viewer plays
  a checkpoint's champions on the run's map; spawns and tick order come from a fresh world.
- Config overrides on the command line (`--config`) — when Sprint 3.4 tuning needs them. The
  manifest already stores the full config, and every file carries its config hash.
- Saving whole populations (only hall-of-fame genomes are saved, as the plan says).
- Live in-browser evolution from random genomes as the viewer's default mode, dashboard and
  charts — Phase 6. The default viewer mode stays the random policy (the golden e2e test uses it).

## Design notes

- **One code path for "play a checkpoint".** `checkpointStart()` in `shared` is used by the viewer
  worker and by the Playwright test in Node, so the test can compute the expected world hash
  without a browser and compare it with the viewer's (cross-engine check of a loaded run).
- **Checkpoint at generation N** = the state after generation N ended: each tribe's hall of fame
  (top K by benchmark score) and its size for the next generation. Played in the viewer as
  "Gen N", each tribe with that size, creature *i* getting hall-of-fame genome *i* mod K.
- **Deterministic outputs, timing kept apart.** Checkpoints and stats depend only on preset, seed,
  config and generation count; wall-clock figures appear only in `run.json`'s `timing` and in the
  summary/progress output. Each seed is independent, so worker scheduling can't change results.
- **Files per seed, no shared state between workers.** A worker gets a job (preset, seed,
  generations, save interval, folder), posts progress, and returns a summary; the main thread
  only prints and writes the multi-seed summary.
- **Viewer reads only what it needs.** All `checkpoint.json` files of a dropped run are read to
  list generations; genome files only for the chosen one. Files are matched by path relative to
  the checkpoint, so a whole run folder, one `gen-NNNN` folder, or its loose files all work.
- **Strict compatibility.** Checkpoints and genome files must match this build's `SIM_VERSION`,
  brain spec and default config hash (plan §3.3); otherwise the viewer says why and keeps running.

---

## What was done

All seven backlog items, on branch `sprint-3.3`.

**sim-core** — `EvolutionRunOptions.start` (`EvolutionStart` / `TribeStart`): a run can begin at
any generation from given genomes, sizes and hall of fame (validated against the map's tribes
and the brain spec; hall of fame re-sorted and capped like `addToHallOfFame`; no RNG draw). The
default random start is untouched: golden hashes unchanged, `SIM_VERSION` stays 6.

**shared** — `run-files.ts`: `run.json` manifest (`serializeRunManifest` / `parseRunManifest`),
`checkpoint.json` (`serializeCheckpoint` / `parseCheckpoint`, plain file names only, ranks
sorted), `RunFileError` (`malformed`, `missing-file`, `sim-version-mismatch`,
`config-hash-mismatch`), `assertCheckpointCompatible`, and `checkpointStart()`, the one function
that turns a checkpoint + its genome files into an `EvolutionStart`. The worker protocol's `init`
takes an optional `start`.

**trainer** (`pnpm train`, root script: builds sim-core → shared → trainer, then runs
`packages/trainer/dist/cli.js`)
- `args.ts`: `--preset --seed --seeds --generations --out --save-every --workers --force --quiet
  --help` with `node:util` `parseArgs` (strict); `parseSeedList` (`1-10`, `1,4,7-9`, no
  duplicates, ≤ 1,000 seeds); defaults `medium`, seed 42, 500 generations, save every
  `benchmarkInterval` (10), workers = min(seeds, CPUs − 1).
- `train-seed.ts`: `trainSeed(job)` runs one seed and writes `run.json`, `stats.json`,
  `stats.csv` and `checkpoints/gen-NNNN/` (`checkpoint.json` + `tribe-<id>-hof-<rank>.genome.json`
  in the genome file format) at generation 1, every N generations and the last one (also when a
  battle royale ends). Refuses an existing run without `--force`.
- `pool.ts` (`runPool`: concurrency limit, results in job order, every job settled),
  `worker-runner.ts` + `seed-worker.ts` (one `worker_threads` worker per seed, progress and
  summary as messages, `workerData` checked), `main.ts` (exit codes 0/1/2, progress per
  checkpoint, `summary.json`/`summary.csv` for several seeds).

**viewer** — "Load run…" (folder picker, `webkitdirectory`), drag-and-drop anywhere on the page
(folders walked with `webkitGetAsEntry`, loose files by name), a "Saved" menu of every checkpoint
found (`Gen 100 · medium-42`, latest of the first run played first), and a status line. The
worker plays the checkpoint with an `EvolutionRun` (evolution continues after it); "Generate" or a
preset change returns to the random-policy world. Incompatible or broken files give a red message
and the current world keeps running. Debug hook: `mode`, `checkpoint`, `checkpointOptions`,
`runMessage`, `runMessageIsError`. `run-loader.ts` (pure, unit-tested) and `run-drop.ts` (DOM).

**Tests** — 51 new Node tests (trainer 27: `args` 10, `pool` 4, `train-seed` 7, `main` 6;
`run-files` 10; `run-loader` 7; `sim-runner` 2; `EvolutionRun` start 5 → 264 Node tests in 37 files)
and `e2e/run-loading.spec.ts` (3): the built CLI trains seeds 1–2 on two
worker threads, the viewer loads `small-1` through the picker and plays Gen 3 — its world hash at
tick 1,600 (after a generation end bred in Chromium) equals Node's for the same checkpoint —
switches to Gen 1 from the menu (hash at tick 50 equal too), loads a dropped `gen-0002` folder of
`small-2` (hash at tick 80 equal), and refuses a checkpoint edited to simVersion 1 with a message.

**Acceptance**

| Criterion | Result |
|-----------|--------|
| Small > 2,000 ticks/s, 500 generations ≈ 6 min | 500 generations (seed 42) in **24.9 s**: 746,703 ticks, **30,028 ticks/s** (includes benchmark runs and file writes) |
| Medium > 1,000 ticks/s, 500 generations ≈ 17 min | 500 generations (seed 42) in **118.0 s**: 990,346 ticks, **8,396 ticks/s** |
| `--seeds` in parallel | Small, seeds 1–7 × 100 generations on 7 worker threads: ≈ 8.3 s wall (slowest seed) vs 4.3 s for one seed alone, ≈ 3.6× the throughput on this 8-thread laptop; seed 1's results identical in-process and in a worker |
| Viewer plays genomes loaded from a run | Playwright, above; manual check: Gen 500 of `small-42` — 27 of 50 creatures still alive at tick 816, where random brains are all dead by ~600 |

Benchmark (mean clone fitness per tribe) generation 1 → 500: Small 499/498 → 948/622, Medium
534/546/499/503 → 1,088/525/708/868. (Timings measured on Windows 11 / Node 24 with other work
running, so conservative.)

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (264), `pnpm test:browser` (6),
`pnpm build`, `pnpm test:e2e` (10; it now builds the trainer chain before Playwright) all pass.

## Retro

**Went well**
- One `checkpointStart()` for the viewer worker and the Node side of the e2e test made "the
  viewer plays exactly those genomes" a hash comparison instead of a visual check, and it also
  proves the GA breeds identically in Chromium (the hash is taken after a generation end).
- The trainer needed no optimisation: 15× (Small) and 8× (Medium) the §3.6 targets, so Sprint
  3.4 can afford multi-seed sweeps of hundreds of generations in minutes.
- Generating the e2e fixture with the real CLI (two seeds) covers the `worker_threads` path
  that vitest can't run (it has no built `seed-worker.js`), with no committed fixture to go stale
  on the next `SIM_VERSION` bump.

**Surprises / learnings**
- `node:util` `parseArgs` treats `--seed -3` as an ambiguous option; negative seeds need
  `--seed=-3` (documented in a test).
- `normalizeSeed` returns `n:42`, fine for hashing but not for folder names and labels; the
  trainer uses the plain seed.
- TypeScript keeps the loop condition's narrowing of `run.finished` after `runGeneration()`; read
  it through a function.
- Tribe progress is uneven within a seed (Medium tribe 1: 546 → 525 over 500 generations while
  tribe 0 doubled) — the arms race plus the size→score feedback noted in the 3.2 review.

**Notes for Sprint 3.4 (tuning)**
- `pnpm train --preset small --seeds 1-7 --generations 100` takes ≈ 10 s here; `summary.csv`
  has the mean benchmark at generation 1 and at the end per seed — enough for quick sweeps.
- Tuning needs config overrides (`--config <file>`): the manifest already stores the full config,
  and the viewer only plays runs whose config hash matches its own `DEFAULT_CONFIG`, so tuned runs
  are watchable once the tuned values become the defaults.
- For "gen 1 vs gen 100" recordings: every run has a generation-1 checkpoint; load the run and pick
  "Gen 1" / "Gen 100" from the menu.

---

## Review (2026-11-24)

A fresh session reviewed PR #11 against plan §3.3, §3.6 and §4 Sprint 3.3, `phase-3.md` and
`CLAUDE.md`, with the implementer's list of things to look at closely.

**Checked, no change needed**
- §3.6 claims re-measured (seed 42, same machine): Small 500 generations in 24.2 s
  (30,917 ticks/s), Medium in 109.9 s (9,013 ticks/s); benchmark figures identical to the ones
  above, so the numbers in "What was done" stand.
- `EvolutionRun` `start`: every map tribe must be listed once, genomes are validated against the
  brain spec, an eliminated tribe can't have creatures, the hall of fame is copied, re-sorted and
  capped, and nothing is drawn from `rng.evolution`. `startGeneration` sorts spawns by tribe id,
  so the order of `start.tribes` can't change the world. Creatures share the caller's genome
  arrays (creature i and i + K even share one); that is safe because genomes are never written in
  place (elites and hall-of-fame entries are copies, mutation only touches new children).
- Checkpoint semantics are described honestly (state after generation N, played as "Gen N",
  creature i → hall-of-fame genome i mod K, fresh spawns and tick order, not a replay). The
  "Saved" menu now also says so in its tooltip.
- `sim-core` determinism rules, config-driven numbers, no `any`; run files carry `simVersion` and
  the config hash (`checkpoint.json`, genome files) and the brain spec (`run.json`, genome files);
  CLI arguments are validated strictly with exit code 2; write order (genome files →
  `checkpoint.json` → stats → `run.json`) leaves a consistent folder when a run is killed.
- `worker_threads`: vitest can't load the built `seed-worker.js`, so `main()` is unit-tested with
  in-thread runners and the real worker path runs in the e2e job on every PR. That is enough
  for the success path; the failure path was untested (fixed below).
- Viewer default mode is still the random policy (the golden e2e test needs it); benchmark
  generations still run the arena inside the worker (see notes for 3.4).

**Found and fixed**
1. **The hall of fame could hold the same genome twice** (rule from Sprint 3.2, surfaced by
   checkpoints). The arena is deterministic, so an elite that is champion again at a later
   benchmark generation gets the same score and took a second slot: Small seed 42 had a duplicate
   in 4 of its 102 saved tribe halls of fame (tribe 0, generations 40–70: `10:557.62` and
   `40:557.62`). Playing a checkpoint made it certain: every creature is a hall-of-fame genome
   and the played generation N is a benchmark generation, so its first generation end
   benchmarked a known genome in the browser (a hitch on Medium) and stored it again. Now
   `addToHallOfFame` skips a genome already present and `endGeneration` reuses a known champion's
   stored score (no arena run). The best entry never changes, so world evolution is identical:
   with the old version number every golden hash still matched, and Small seed 42 retrained over
   500 generations gives the same stats with no duplicates. Saved halls of fame differ, so
   `SIM_VERSION` 6 → 7 and the golden hashes were re-recorded (only the version stamp moved them).
2. **Refusal messages didn't say what to do.** A run from another `simVersion` or config now
   reads e.g. "the run was trained with other settings (config …; this build's default config is
   …): a balance value in config.ts changed since. Train it again with this build (pnpm train) to
   watch it." Important for Sprint 3.4: any `DEFAULT_CONFIG` change makes older runs unplayable.
3. **The "Saved" menu showed a refused generation as selected**, and picking it again fired no
   `change`. Nothing is selected now until a checkpoint actually plays (e2e asserts it).
4. **Test gaps closed.** `test/run-drop.test.ts` (5 tests) walks dropped folders with stand-in
   `FileSystemEntry` trees (nested folders, `readEntries` batches, non-JSON skipped, mixed items,
   fallback to the file list, folder-picker paths) and feeds the result through the loader. The
   e2e suite now runs the built CLI a second time on the same folders without `--force`: both
   worker threads fail and the CLI exits 1 naming each seed.
5. **Race in the e2e test.** It read the state as soon as the checkpoint label appeared, but the
   label is set at once while the map and snapshot arrive with the worker's reply; once it saw
   the old Medium map (`preset` "medium"). It now waits for the label, the preset and the saved
   generation together.

New tests: `EvolutionRun` (champion already in the hall of fame is not benchmarked again; a given
hall of fame is deduplicated and capped), hall of fame (distinct genomes, `sameGenome`), refusal
messages (`run-files`), `run-drop` (5), e2e (CLI worker failure; menu after a refusal).

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (273 tests in 38 files),
`pnpm test:browser` (6), `pnpm build`, `pnpm test:e2e` (11) pass locally.

**Notes for Sprint 3.4**
- `SIM_VERSION` is 7: runs made before this review must be trained again to be watched.
- In the viewer, generation ends at benchmark generations still run the arena in the worker for
  every tribe whose champion is new (a short hitch on Medium). Fine for now; Phase 6 could move it
  off the tick loop or skip it in the viewer.
- Tuning needs `--config` overrides; tuned runs are watchable once the tuned values become the
  defaults (strict config-hash matching, plan §3.3).
