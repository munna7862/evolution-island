# Sprint 5.1 — Runs & resumable training

- **Phase:** 5 — Persistence & Replays (`docs/phases/phase-5.md`)
- **Branch:** `sprint-5.1`
- **Personas:** Simulation Architect (run state, determinism), SDET (kill-and-resume test),
  Frontend / Rendering Dev (run browser)

## Goal

Plan §4 Sprint 5.1: checkpoint and resume runs; a run browser in the viewer (pick run → tribe →
generation); refuse or migrate files whose `simVersion` / brain spec / config hash don't match.
✅ Kill and resume a run → same result as an uninterrupted run.

## Starting point (`main` at `357d512`, `SIM_VERSION` 13)

Run folders (Sprint 3.3) hold `run.json`, `stats.json`/`stats.csv` and checkpoints with each
tribe's hall of fame. A checkpoint is enough to *watch* a generation, not to continue training it:
the generation's genomes, the RNG streams and the tribes' histories are not saved.

## Design

- **Run state = the moment between two generations.** `EvolutionRun` keeps what it passed to
  `World.startGeneration` last (generation, spawns = each tribe's genomes in order) together with
  the RNG stream states and `tickCount` *before* that call, plus the tribes (size, alive, hall of
  fame, history) and finished/winner. The world right after `startGeneration` depends on nothing
  else (food full, territory and occupancy cleared, ids from 0), so `EvolutionRun.restore()`
  rebuilds it by setting the RNG streams back and calling `startGeneration` with the same spawns.
  New `RngStream.setState`.
- **`resume.json`** (shared `serializeRunState` / `parseRunState`, format
  `evolution-island/run-state`, carries `simVersion`, config hash, brain spec), rewritten at every
  checkpoint. Weights as JSON numbers (float32 round-trips exactly).
- **`pnpm train --resume <run folder> --generations N`:** reads `run.json` (config, preset, seed,
  save-every), `stats.json` and `resume.json`, refuses on `simVersion` / config hash / brain spec
  mismatch (with the reason), continues to generation N, appending stats and checkpoints.
- **Viewer run browser:** separate Run, Generation and Tribe menus (Tribe: all tribes, or one
  tribe's champions alone on its zone) instead of one flat checkpoint menu.
- **Incompatible files:** genome, checkpoint and run-state files are refused with what differs
  and what to do (as since 3.3). Migration across `simVersion`s is not possible (the rules changed),
  so "migrate" applies only to brain growth within one `simVersion` (not needed yet): recorded.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file, `phase-5.md` | Before coding |
| 2 | `RngStream.setState`; `EvolutionRun.captureState()` / `restore()` | Unit test: restore at any generation boundary → identical `run.hash()` for the rest of the run |
| 3 | `resume.json` serialization, refusals | Round-trip and refusal tests |
| 4 | Trainer `--resume` | **Kill-and-resume test:** 4 generations then resume to 7 = 7 straight (same stats, checkpoints, resume state) |
| 5 | Viewer run browser (run → tribe → generation) | Unit tests; e2e |
| 6 | Docs, retro | — |

---

## What was done

- **Run state** (sim-core): `RngStream.setState`; `EvolutionRun` remembers each generation start
  (RNG states and `tickCount` before it, spawns) in `beginGeneration`, `captureState()` returns
  it with deep copies of the tribes (size, alive, hall of fame, history) and finished/winner, and
  `createEvolutionRun({ …, resume })` sets the streams and tick count back and redoes the same
  `startGeneration`. No rule changed: `SIM_VERSION` stays 13, golden hashes unchanged.
- **`resume.json`** (shared `run-state.ts`): `serializeRunState` / `parseRunState` (format
  `evolution-island/run-state`, every field validated) and `assertRunStateCompatible`, which
  refuses another `simVersion` ("the rules changed since… train it again"), another config hash
  or another brain spec.
- **Trainer:** every checkpoint also writes `resume.json`; `pnpm train --resume <run folder>
  --generations N` takes preset, seed, config and save interval from `run.json` (other flags are
  refused), checks the state, and continues, appending stats and checkpoints. `--force` also
  clears `resume.json`.
- **Viewer run browser:** Run, Saved (generation) and Tribe menus; picking a run lists its
  generations and plays the latest; "Tribe" plays every tribe or one tribe's champions alone
  (`onlyTribe`: the others are left out, their zones empty).
- **Incompatible files:** genome, checkpoint and run-state files are refused with the reason.
  "Migrate" is not possible across `simVersion`s (the rules changed, so a migrated genome would not
  behave as it was trained); `migrateGenome` (Sprint 3.5) covers brain growth within one version.

**Tests** (379 unit in 46 files, +14; e2e 12, +1):
- `resume.test.ts`: `setState`; restore at generation 1, 4 and 7 continues with the same
  `run.hash()` after every later generation and the same world hash at the restore point; the
  captured state is a copy; capture only between generations; another map refused; a finished
  battle royale stays finished.
- `run-state.test.ts`: round trip (the resumed run continues like the original), refusals with
  reasons, malformed weights.
- **Kill and resume** (`train-seed.test.ts`): a run whose process dies after generation 5 (only
  checkpoints 1 and 3 written), resumed to 7, leaves **exactly the same files** as an uninterrupted
  run of 7 (stats, checkpoints, genome files, `resume.json`; only `run.json`'s wall-clock timing
  differs); resuming twice from regular checkpoints too; another config and "nothing left to do"
  refused.
- `--resume` argument rules; run browser helpers; e2e: pick a folder of two runs, switch run (its
  generations replace the menu), play one tribe alone (the other tribe's population is 0).

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (379), `pnpm test:browser` (9),
`pnpm build`, `pnpm test:e2e` (12) pass; the built CLI resumed a 2-generation run to 4.

## Retro

**Went well**
- Choosing the generation boundary as the save point kept the state small and obviously complete:
  the world after `startGeneration` depends only on what is saved, so no world internals had to be
  serialized.
- The kill test compares whole folders, so any file the resume path forgot to write (or wrote
  differently) fails it.

**Surprises / learnings**
- The first kill test "killed" a run by asking for fewer generations, which made that generation
  the run's last and gave it an extra checkpoint; a real kill throws mid-run instead.
- Mid-generation resume would need the whole world (food, positions, territory, memory, calls);
  with generations of 3,000+ ticks training loses at most one checkpoint interval, so it isn't
  worth it.

**Notes for Sprint 5.2**
- Replays can reuse the same idea: a replay = a run state (or a checkpoint start) + recorded
  spectator events + periodic world hashes.

## Reviews (2026-11-25)

Two passes in the implementing session (the app does not let it start sessions from an automated
turn) over `git diff 357d512...sprint-5.1`.

**Review 1 — correctness.** Checked: a resumed run that had already finished (battle royale)
trains nothing more and reports the right generation count; `--resume` always runs in-process, so
the worker-thread job validation never sees it; `resumeFrom` restores the streams and tick count
before redoing `startGeneration`, and the map stream is unused after generation; copying each
generation's spawns costs ~77k floats a generation on Medium (negligible); picking a tribe that has
no champions shows the reason instead of crashing. **Found:** nothing to fix.

**Review 2 — docs and tests.** Checked: the counts above (+14 unit tests in 2 new files, 12 e2e);
the kill test's folder comparison covers `run.json`'s generation count and checkpoint list (timing
excluded) and every genome file; plan, phase and sprint texts agree. **Found:** nothing to fix.
