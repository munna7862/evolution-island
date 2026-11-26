# Sprint 8.1 — NEAT brains & comparison

- **Phase:** 8 — NEAT brains (optional) (`docs/phases/phase-8.md`)
- **Branch:** `sprint-8.1`
- **Personas:** ML / Evolution Engineer, SDET

## Goal

Plan §4 Phase 8:
- Replace the fixed MLP with NEAT (evolving topology) and compare learning speed against v1.
- ✅ A benchmark-arena comparison of NEAT and the MLP over 3 seeds, written up in `docs/`.

## Design

- **`brain.kind`** is `'mlp'` (default) or `'neat'`, with `brain.neat` holding the rates and caps.
  - A NEAT spec is brain format 2, with the same inputs and outputs as the MLP; `hidden` is the hidden-node cap.
  - Memory, calls, the policy, the benchmark arena, run files and replays all work for both brain kinds.
- **`sim-core/src/neat.ts`:**
  - Flat-array encoding: node and connection genes, with whole numbers exact in float32.
  - `validateNeatGenome`: layout, existing nodes, direction, sorted and unique, finite weights, no cycle, hidden-node cap.
  - `compileNeat`: cached per genome; topological order with ties broken by id. `neatForward` uses float64 sums in a fixed order and softsign for hidden nodes; outputs are linear.
  - `randomNeatGenome`: every input connected to every output.
  - `NeatRegistry`: hidden-node ids by the split they came from, rebuilt from the genomes alive.
  - `crossoverNeat`: the fitter parent's structure, with one coin per matching gene.
  - `mutateNeat`: a fixed draw order of weight noise, toggles, one add-connection (feed-forward only) and one add-node.
- **`genomeOps(spec, evolution, brain, existing)`:** the random, crossover and mutate operators of either brain.
  - `breedGenomes` and `respawnGenomes` take them; `EvolutionRun` builds them once per breeding from all members and halls of fame.
  - The MLP operators draw exactly as before.
  - `brainActivations` gives the inspector hidden and output values for both brain kinds.
  - The mute test of `pnpm analyze` zeroes a NEAT genome's connections out of the muted inputs.
- **`SIM_VERSION` 15:** the brain kind and NEAT settings are in the config hash.
  - Golden hashes are re-recorded, with a new `neat` evolution scenario.
  - Run against `main`, the MLP's world-state hashes are identical (`hashWorldState`, which leaves out the config hash), both after generations 2, 3 and 4 of an evolution run and after 600 random-policy ticks.

## What was done

As designed.

**Comparison:** in `docs/neat-vs-mlp.md` (Small, seeds 801–803, 100 generations).
- No clear winner.
- NEAT is ahead at generations 20–30, mean 1,173 against 858 at generation 30.
- The MLP ends higher: a late mean of 1,925 against 1,588, ahead on 2 of 3 seeds.
- The MLP stays the default.

**Tests:**
- `neat.test.ts` (11):
  - spec from config; initial genome and round trip; forward pass by hand and the compile cache;
  - malformed genomes refused, each with its reason;
  - the add-node split; registry ids;
  - 200 rounds of every mutation stay valid, acyclic and within the caps;
  - crossover keeps the fitter structure and mixes matching genes;
  - a NEAT policy drives creatures, memory included;
  - `genomeOps` draws;
  - a NEAT run resumed after generation 4 matches the continuous run through generation 7.
- Golden `neat` scenario, run in Node and the browsers.
- `brain.test.ts`: format 2 is accepted, format 3 refused.

**Verification:**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (444 in 56 files), `pnpm build` and `pnpm test:browser` (36, Chromium, Firefox and WebKit) pass locally.
- `pnpm test:e2e` passes (16, with 2 perf tests skipped) when run with one worker. With 3 workers, 6 tests timed out while the machine sat at 90 % CPU from another program.

## Retro

**Went well**
- Keeping NEAT genomes as flat float arrays meant no file format, replay, hash or viewer change.
- Deriving node ids from the split and rebuilding the registry from living genomes made resume exact with no new run state.

**Surprises / learnings**
- NEAT's minimal start learns simple behaviour sooner, but its champions stayed nearly linear; the plain toggle rate switched off about a quarter of the connections.
- The first training-speed numbers (3× slower) were mostly machine load. Measuring creature-ticks per CPU second, with the two brains alternating, gave about 1.2–1.5×.

## Reviews (2026-11-26)

Two review passes in this session.

**Pass 1** — one fix:
- **The viewer's refusal named the wrong cause.** The viewer plays runs made with the default config only. A NEAT run folder, or any run trained with `pnpm train --config`, was refused because "a balance value in config.ts changed since". The message now names `--config` (for example NEAT brains) as well as a changed default, and says the viewer plays default-config runs. Its test checks the new wording.

Checked and fine:
- No other code assumes a fixed genome length: the inspector, run files, replays, analysis, the arena and validation all dispatch on the brain format.
- The NEAT compile cache is safe, because NEAT genomes are never changed in place: mutation returns a new array.

**Pass 2** — no defects:
- **Determinism:** the ready list is sorted on every step, the registry follows Map insertion order, weights round to float32 on encode as the MLP's do, and a coin is drawn only per matching gene.
- **Breeding operators:** `breedGenomes` and `respawnGenomes` build default operators only when a caller passes none; `EvolutionRun` always passes the run's own.
- **Hall-of-fame respawns:** these candidates are ordered best first, so "fitter parent" by index holds.

**Known limitation (follow-up, not done):** the viewer can't play NEAT runs, because it plays default-config runs only. Watching them needs the worker to take a run's stored config, which is the same limit as for any `--config` run.
