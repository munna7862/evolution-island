# Sprint 5.2 — Save / load / replay

- **Phase:** 5 — Persistence & Replays (`docs/phases/phase-5.md`)
- **Branch:** `sprint-5.2`
- **Personas:** Simulation Architect (replay format, determinism), SDET (cross-engine suite),
  Frontend / Rendering Dev (export / load in the viewer)

## Goal

Plan §4 Sprint 5.2: export a replay from the trainer or the viewer as a single shareable file and
play it back in the viewer. Replay = seed + config + genomes + recorded spectator events +
`simVersion` → deterministic re-run, with periodic state-hash checkpoints to pinpoint divergence.
✅ Same replay file → same final state hash in Node **and** in Chromium, Firefox and WebKit.

## Starting point (`main` at `a39d2e5`, `SIM_VERSION` 13)

Sprint 5.1 made runs capturable between generations (`EvolutionRun.captureState`, `resume.json`).
Outside input between ticks today is only play/pause/speed/step, which never changes the world.

## Design

- **Replay file** (shared `replay.ts`, format `evolution-island/replay`): `simVersion`, the full
  config and its hash, preset, seed, the **start** (a run state, as in `resume.json`: every
  creature's genome, the RNG streams, tribes with hall of fame and history), the number of
  **ticks** to play, **hashes** of `run.hash()` every `hashEvery` ticks and at the end, and
  **events** (spectator input, recorded with its tick). No event changes the world yet (disasters
  arrive in Sprint 7.2), so the list is empty today and unknown event types are refused.
- **`recordReplay` / `playReplay`** (shared, used by Node and the viewer worker): record runs an
  `EvolutionRun` from the start and stores the hashes; play re-runs it and reports the first tick
  whose hash differs (expected vs actual), or the final hash when all match.
- **Trainer:** `pnpm replay export (--run <run folder> | --preset P --seed S [--config f])
  --ticks N [--hash-every K] --out <file>` and `pnpm replay verify <file>` (exit 1 on divergence).
- **Viewer:** "Load replay" (also by dropping the file): plays it, checking every recorded hash and
  stopping at the end; the HUD shows "Replay: tick t / N · hashes ok k / m" or the first mismatch.
  "Export replay" (while watching a checkpoint or a replay): the file of what was played since its
  start, with hashes, downloaded as `<preset>-<seed>-gen<N>.replay.json`.
- **Cross-engine:** the Vitest browser suite runs in Chromium, **Firefox and WebKit**; a replay
  test plays a pinned replay and checks its pinned final hash in Node and the three engines. CI
  installs the three browsers.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file | Before coding |
| 2 | Replay format, record/play, validation, divergence report | Unit tests: round trip; play = record; a changed hash or genome is found at the right tick; refusals |
| 3 | `pnpm replay export / verify` | CLI tests |
| 4 | Viewer load / export / HUD status | Unit tests; e2e: export from a checkpoint, load it back, same final hash as Node |
| 5 | Cross-engine replay suite in Node, Chromium, Firefox, WebKit; CI installs them | `pnpm test`, `pnpm test:browser` green in all three engines |
| 6 | Docs, retro | — |

---

## What was done

- **Replay format** (shared `replay.ts`): `recordReplay`, `playReplay` (stops at the first hash
  that differs and reports tick, expected and actual), `serializeReplay` / `parseReplay` (refuses
  another `simVersion`, a config that doesn't match its hash, unknown events and bad fields).
  `run-state.ts` now shares its JSON conversion (`runStateToJson` / `runStateFromJson`) with
  replays.
- **`pnpm replay`** (trainer `replay-cli.ts`): `export --run <folder>` (from its `resume.json`) or
  `export --preset --seed [--config]` (from generation 1), `--ticks`, `--hash-every`, `--out`;
  `verify <file>` (exit 1 on divergence).
- **Viewer:** "Load replay…" (or drop a `*.replay.json`): the worker plays it, checks each
  recorded hash, stops at the end or the first mismatch, and the run message shows "Replay …: tick
  t / N · hashes ok k / m" (or "DIVERGED at tick …"). "Export replay" (while watching a saved
  generation or a replay) downloads what was played since its start, with a hash every 500 ticks
  and at the end. Snapshots carry the replay status; the debug hook has `replay` and
  `exportReplay()`.
- **Cross-engine:** `pnpm test:browser` now runs in **Chromium, Firefox and WebKit** and includes
  `replay-cross-engine.test.ts`: a pinned replay (Small seed 42, 1,500 ticks, a hash every 300)
  recorded, serialized, parsed and played to its pinned final hash `c2e53ca6fa320079`. CI installs
  the three browsers. (Locally, Playwright's Firefox 1572 and WebKit 2388 were downloaded with the
  user's OK.)
- No rule changed: `SIM_VERSION` stays 13.

**Tests:** 390 unit tests in 49 files (+11: replay format 4, cross-engine replay 1 in Node, worker
replays 3, `pnpm replay` 3), browser 30 (golden + replay in three engines), e2e 13 (+1: a replay exported from a
checkpoint played in Chromium, verified in Node, loaded back and played to its end with every hash
matched). The built CLI exported a 1,200-tick replay from a saved run and verified it; a tampered
copy was reported at tick 100 with exit code 1.

## Acceptance

✅ The same replay gives the same final state hash in **Node, Chromium, Firefox and WebKit**
(`replay-cross-engine.test.ts`, 3 engines + Node), and a replay recorded in Chromium plays back
hash for hash in Node and in the viewer (e2e).

## Retro

**Went well**
- Sprint 5.1's run state made the replay start trivial: a replay is a run state plus ticks and
  hashes, with no world serialization.
- Running the golden scenarios in Firefox and WebKit for the first time passed at once: the
  engine-exact math rules (plan §3.3) hold.

**Surprises / learnings**
- The installed Firefox and WebKit builds were older than this Playwright's, so the first browser
  run failed to launch; browser binaries have to be installed per Playwright version (CI does it).
- There is no spectator event that changes the world yet, so the replay format reserves `events`
  and refuses any until Sprint 7.2 defines them.

**Notes for later**
- Sprint 7.2 (disasters): add event types to `ReplayEvent`, apply them between ticks in
  `playReplay` and the worker, and record them on export.

## Reviews (2026-11-25)

Two passes in the implementing session (the app does not let it start sessions from an automated
turn) over `git diff a39d2e5...sprint-5.2`.

**Review 1 — correctness and tests.** Checked: a replay stops before its last tick is exceeded and
at the first mismatch; exporting while a replay plays starts from the replay's own start; dropping
a single `*.replay.json` plays it, folders still load as runs. **Fixed:** (1) the backlog promised
CLI tests but the CLI ran on import and had none: its logic moved to `replay-command.ts`
(`replayMain`), with 3 tests (export from a run folder and from generation 1, verify, divergence
exit 1, bad input exit 2); (2) the worker's "end with the final hash" condition was written as an
always-true check plus the real one; now just the real one.

**Review 2 — docs and consistency.** Checked: plan revision note, phase decision and sprint text
agree; the pinned replay hash is pinned like the golden hashes (re-record only with a
`SIM_VERSION` bump). **Fixed:** the test counts above (390 in 49 files).
