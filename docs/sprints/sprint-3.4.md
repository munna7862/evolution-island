# Sprint 3.4 — First "it learns!" milestone 🎉

- **Phase:** 3 — Brains & Evolution (`docs/phases/phase-3.md`)
- **Branch:** `sprint-3.4`
- **Personas:** ML / Evolution Engineer (sweeps, GA settings, reward design), Game Designer
  (fitness weights, food/water balance), SDET (acceptance measurements, exploit tests, golden
  hashes), Frontend / Rendering Dev (gen 1 vs gen 100 recording)

## Goal

Tune the config until creatures clearly learn to seek food and water (plan §4 Sprint 3.4, §2.7
"very likely" behaviour), measured by the benchmark arena on several seeds, and show it: gen 1 vs
gen 100 side by side (Milestone M3).

## Starting point (`main` at `b4dd3bc`, `SIM_VERSION` 7)

Small, seeds 1–7, 100 generations, benchmark per tribe gen 1 → gen 100:

| Seed | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|------|---|---|---|---|---|---|---|
| Tribe 0 | 762 → 942 | 472 → 1,034 | 532 → 513 | 763 → 938 | 517 → 508 | 531 → 928 | 577 → 1,082 |
| Tribe 1 | 528 → 992 | 499 → 470 | 512 → 542 | 684 → 994 | 465 → 537 | 524 → 769 | 539 → 498 |

Seeds 3 and 5 learn nothing in 100 generations; on 3 more seeds one tribe stalls. Medium seed 42:
534/546/499/503 → 1,015/522/567/761 at generation 100.

## Acceptance bar (fixed before the held-out run)

Measured **once** with `pnpm train --preset small --seeds 101-120 --generations 100` and the
shipped `DEFAULT_CONFIG`. Seeds 101–120 are **held out**: no sweep used them, so the result says
whether the tuning generalises rather than whether it fits the seeds it was tuned on. No re-run and
no re-tuning against them. "Benchmark" is the champion's benchmark-arena score recorded in
`stats.csv` at that generation; a seed's *ratio* is its mean generation-100 benchmark over the
tribes ÷ its mean generation-1 benchmark.

The bar passes only if all three hold:

1. **Clearly rising on average:** the mean of the 20 per-seed ratios is ≥ **2.0**.
2. **On most seeds:** at least **12 of 20** seeds each reach a generation-100 mean ≥ 2× their
   generation-1 mean **and** ≥ 2× the arena score of a brain that only `STAY`s (515 with the
   shipped config; so a change that just makes generation 1 worse can't pass).
3. **Most tribes learn:** at least **75 %** of all tribes (30 of 40) reach ≥ **1.5×** their own
   generation-1 benchmark.

Every seed's numbers are reported below, pass or fail.

*Changed during the sprint, before any held-out seed was run* (user's decision, 2026-11-24). The
first bar, fixed before tuning, asked for all three conditions (2×, 2× STAY-only, every tribe ≥
1.5×) on **each** of three held-out seeds 101–103. Tuning showed that a 100-generation outcome is
still partly luck per seed: the best config met that per-seed bar on 25 of 40 tuning seeds (≈ 62 %;
≈ 72 % for the plain 2× rule), because about one tribe in seven locks into "always EAT" or "always
DRINK". Three of three would then pass only 25–40 % of the time, which says more about luck than
about learning, and so would "4 of 5" (≈ 57 %). Twenty seeds with thresholds on the mean and on the
share of seeds and tribes measure the same thing with far less luck.

Recorded, not blocking: the same check on the tuning seeds (sweep table below), Medium seeds
101–103 at generation 100, and Small/Medium seed 42 over 500 generations (comparison with Sprint
3.3).

Visual check: in the viewer, a run of the new defaults loaded with "Load run…", "Gen 1" vs
"Gen 100": generation-1 creatures wander or stand and die of thirst; generation-100 creatures
walk to water and food, drink and eat, and are still alive well after tick 600. A GIF of both is
committed under `docs/`.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file: baseline, acceptance bar, definition of done | Written before any tuning |
| 2 | `shared/config-override.ts`: a partial config JSON merged onto `DEFAULT_CONFIG`, validated (unknown keys, wrong types, non-finite numbers, bad enum values, wrong array lengths, preset ids refused with the key's path) | Unit tests: merge keeps everything not mentioned, nested presets merge per preset, each refusal case |
| 3 | Trainer `--config <file>`: reads the override, trains every seed with the merged config (worker threads too), the default `--save-every` follows its `benchmarkInterval`, the header prints the config hash; bad file → exit 2 with the reason | Unit tests for parsing and `main()` (config reaches the run: `run.json` stores it and its hash) |
| 4 | Sweeps on Small seeds 1–7 (then 1–20 for the finalists), 100 generations: initial weight range, mutation rate/σ, elites, parent fraction, selection mode, fitness weights, generation length, food/water balance | Every sweep recorded below (what, why, result) |
| 5 | The winning values become `DEFAULT_CONFIG` (all in `config.ts`); `SIM_VERSION` bump if behaviour changes; golden hashes re-recorded; exploit tests still pass (and new ones for any new fitness term); the Sprint 3.2 evolution test re-checked | `pnpm test` green |
| 6 | Acceptance run on held-out seeds 101–120, once | Bar above met, every seed's numbers recorded |
| 7 | Viewer: train a run with the new defaults, load it, compare Gen 1 vs Gen 100; record a GIF to `docs/` | GIF committed, visual check described |
| 8 | Docs: this file (results, retro), `phase-3.md`, plan revision note for the new defaults | — |

## Definition of done

- Acceptance bar met on the 20 held-out seeds, every seed's numbers recorded here.
- GIF of gen 1 vs gen 100 committed.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`, `pnpm test:e2e` pass
  locally and in CI.
- Every fitness term keeps an exploit test (`CLAUDE.md`).

## Out of scope

- Memory neurons — Sprint 3.5.
- Combat, sharing, territory, tribe-score balance on Medium (the "leader stays at `popCap`" lead
  from the 3.2 review) — Sprint 4.1 / 4.2. Small has fixed tribe sizes, so the acceptance bar is
  not affected by it.
- Sensor or brain changes (they would need genome migration); this sprint changes config values
  only, unless a sweep shows a rule is broken.
- Resuming runs, migrating old runs to the new config — Sprint 5.1. Runs trained before the new
  defaults stop being playable in the viewer (strict config hash, plan §3.3).

---

## What was done

On branch `sprint-3.4`.

**Trainer `--config <file>`** (commit `97aeb0a`). `shared/config-override.ts`
(`applyConfigOverride`, `parseConfigOverride`, `ConfigOverrideError`) merges a partial config JSON
onto `DEFAULT_CONFIG`: objects key by key (presets one at a time), arrays whole. It refuses unknown
keys, wrong types, non-finite numbers, fractional or negative whole-number fields (they hash as
32-bit integers), unknown `selection`/`extinction` values, wrong array lengths and preset id
changes, naming the key path. A full config (e.g. a `run.json`'s) is a valid override. The CLI
reads the file in `main()` (`CliIo.readTextFile`), passes the merged config to every seed (worker
threads too), prints `Config <hash> (defaults + <file>)`, checkpoints at the config's
`benchmarkInterval` unless `--save-every` is given, and exits 2 with the reason for a missing or
bad file. Tests: `config-override.test.ts` (11), `args` (+2), `main` (+3 and the worker check).

**Diagnosis** (scratch scripts on top of the built packages: arena inspection, population
benchmarks, survival curves; none committed).
- The arena floor and ceiling on Small: a STAY-only brain scores 465, DRINK-only 499, a
  hand-written forager 1,262 (17 of 25 clones alive at the end; 8 never reach water).
- Gen-100 champions of the old defaults **never moved**: "EAT where you stand, DRINK if water is
  adjacent". Clones that spawned next to water lived; the rest died of thirst at tick 532.
- Whole tribes locked into **"always EAT"** (or "always DRINK") for 100–300 generations: every
  genome of seed 3's tribe 0 scored ~500 after 300 generations. EAT-only reliably adds 67 ticks
  of life on almost any tile, DRINK only next to water, so without a lucky drinker in generation
  1 the population converges on eating.
- Not map overfitting: champions score the same on their own map as in the arena.
- At 1,500 ticks a creature parked on a good shore tile survives on starting reserves plus the
  tile's regrowth, so the generation barely separates foragers from sitters, and the arena ceiling
  sits just above the 2× bar.

**Sweeps** (Small, 100 generations; "full" = seeds meeting all three criteria of the bar,
"ratio" = mean over seeds of gen-100 mean / gen-1 mean). Each row is one `pnpm train --seeds …
--config …` run.

| Change (on top of the row's base) | Seeds | Ratio | Seeds ≥ 2× | Tribes ≥ 1.5× | Full |
|---|---|---|---|---|---|
| Old defaults (baseline) | 1–20 | 1.45 | 0/20 | 18/40 | 0/20 |
| initial weights ±1 / ±3 | 1–10 | 1.53 / 1.33 | 1 / 0 | 8 / 6 of 20 | 1 / 0 |
| σ 0.4 / σ 0.1 | 1–10 | 1.46 / 1.19 | 1 / 0 | 8 / 3 | 1 / 0 |
| mutation rate 0.1 / 0.02 | 1–10 | 1.34 / 1.32 | 0 / 0 | 5 / 5 | 0 / 0 |
| tournament 3 / 5 | 1–10 | 1.42 / 1.40 | 1 / 0 | 8 / 7 | 1 / 0 |
| elites 1 / 5, parent fraction 0.4 / 0.1 | 1–10 | 1.33–1.48 | 0 | 3–9 | 0 |
| crossover off | 1–10 | 1.14 | 0 | 2 | 0 |
| intake weights ×2.5 (food 5, water 5) | 1–10 | 1.37 | 0 | 6 | 0 |
| move cost 0.1 / hydration drain 0.2 | 1–10 | 1.16 / 1.31 | 0 / 0 | 2 / 5 | 0 / 0 |
| **±1 + σ 0.4 + tournament** ("T") | 1–10 | 1.74 | 2 | 14 | 2 |
| T with σ 0.6 / 0.8 / 1.0 / 1.2 | 1–10 | 1.76 / 1.86 / 1.76 / 1.83 | 1–4 | 16–17 | 0–4 |
| T σ 0.8 + rate 0.1 / elites 4 / clamp 8 / vision 6 / elites 0 | 1–10 | 1.63–1.79 | 1–4 | 12–15 | 1–4 |
| T σ 0.6 + food 20, water 10 | 1–10 | 1.84 | 3 | 16 | 3 |
| T σ 0.8 + generation 2,000 / 2,500 / 3,000 | 1–10 | 1.96 / 1.93 / 1.87 | 4 / 5 / 4 | 17 / 14 / 15 | 4 / 5 / 4 |
| unit-length food/water direction sensors (local code experiment, reverted) | 1–10 | 1.43 | 0 | 7 | 0 |
| T σ 0.8, generation 1,500 | 1–20 | 1.76 | 6 | 29/40 | 6 |
| T σ 0.6, generation 3,000 | 1–20 | 2.11 | 12 | 31/40 | 9 |
| **T σ 0.6, generation 3,000, energy drain 0.2** (new defaults) | 1–20 | 2.41 | 17 | 36/40 | **15** |
| … same, fresh seeds | 21–40 | 2.26 | 12 | 33/40 | 10 |
| … energy drain 0.15 / 0.175 | 1–20 | 2.62 / 2.42 | 16 / 15 | 34 / 31 | 14 / 13 |
| … σ 0.8 / σ 0.4 | 1–20 | 2.43 / 2.16 | 14 / 11 | 31 / 30 | 10 / 10 |
| … elites 4 / rate 0.1 | 1–20 | 2.53 / 2.54 | 17 / 18 | 37 / 34 | 16 / 15 |
| … generation 1,500 / 2,000 / 4,000 | 1–20 | 1.59 / 1.96 / 2.51 | 1 / 10 / 16 | 25 / 32 / 35 | 1 / 9 / 14 |
| energy drain 0.2 + generation 3,000, old GA settings | 1–20 | 1.70 | 5 | 19/40 | 3 |
| Medium, new defaults (generation 4,000) / generation 2,000 / old defaults | 1–6 | 2.12 / 1.71 / 1.50 | 4 / 1 / 0 | 19 / 18 / 13 of 24 | 2 / 1 / 0 |

All three parts are needed: the GA settings alone reach ~1.8, the drain and generation length
without them 1.70, together 2.3–2.4. Elites 4 and mutation rate 0.1 were within the noise of the
chosen row (≈ ±2 "full" seeds of 20), so the fewer-changes variant was kept.

**New defaults** (`config.ts`, with the reasons in comments): `creature.baseEnergyDrain` 0.25 →
0.2; `generationLength` Small/Medium/Large/Huge 1,500/2,000/3,000/4,000 → 3,000/4,000/6,000/8,000;
`evolution.selection` truncation → tournament (size 3); `initialWeightRange` 2 → 1;
`mutationSigma` 0.2 → 0.6. `SIM_VERSION` 7 → 8; golden hashes re-recorded (map hash unchanged;
world hashes and the `brainOutputs` digest changed because energy drains slower, so the energy
sensor reads differently; in the brain scenario 26 of 50 creatures are dead by tick 600, all by
700). Exploit tests unchanged and green: an only-STAY creature now dies at tick 516 (was 466),
still ≤ 600 and < half the shortest generation. Tests that relied on truncation being the default
now set it. The e2e test that plays past a generation end now asks Node when the played
generation ends instead of assuming 1,500 ticks.

**Regression test for the milestone.** `evolution-learns.test.ts` now runs Small seed 42 (not
used in any sweep) for 100 generations: benchmark 541/561 → 1,437/1,075 (mean 2.28×, tribes
2.66× and 1.92×, STAY-only brain 515). It asserts the Sprint 3.4 bar there, plus the Sprint 3.2
check at generation 50 (1.45×). ≈ 7 s.

**What a generation-100 champion does** (arena, seed 17's tribe 0, score 2,158): 18 of 25 clones
walk a few tiles to the shore, then alternate EAT and DRINK and live 2,000–3,000 ticks, eating
20–28 bites and drinking 24–35; 7 never reach water and die at tick 532. Foraging trips away from
the water are rare: the learned skill is "find water, stay by it, eat what grows there".

**Visual check and GIF** — `docs/media/sprint-3.4-gen1-vs-gen100.gif`. A run of the new defaults
(`pnpm train --preset small --seed 42 --generations 100`) loaded in the viewer with "Load run…";
"Gen 1 · small-42" on the left and "Gen 100 · small-42" on the right, played in two browser pages
paused at the same ticks (0–800 every 20 ticks, then every 100 to 2,999), cropped to both tribes'
start zones. Each side freezes when its own generation ends (the viewer would start the next
one). Gen 1 (25 clones of each tribe's generation-1 champion) mostly stands where it spawned; all
50 are dead at tick 699, the last 10 together, from hunger beside the water they drank from (they
apparently never ate). Gen 100 (each tribe's five hall-of-fame genomes) heads for the ponds: the Amber tribe lines
up along its pond's shores, 19 of 50 are alive at tick 700, 13 at 1,300, 10 at 1,800 and 5 at the
end of the 3,000-tick generation. Recorded with Playwright screenshots of the preview build and a
small GIF89a encoder (scratch scripts, not committed); 63 frames, 1,286 × 405, 0.29 MB.
