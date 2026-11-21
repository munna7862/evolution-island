# Sprint 3.2 — Generations & genetic algorithm

- **Phase:** 3 — Brains & Evolution (`docs/phases/phase-3.md`)
- **Branch:** `sprint-3.2`
- **Personas:** ML / Evolution Engineer (fitness, selection, crossover, mutation, benchmark arena),
  Game Designer (fitness and tribe-score weights, exploit closing), Simulation Architect
  (generation reset, RNG stream discipline, determinism), SDET (exploit tests, evolution test,
  golden scenario)

## Goal

Creatures carry their own genomes, generations end and restart, and each tribe's gene pool evolves
by fitness (effective intake + survival), with tribe sizes re-allocated by tribe score, extinction
handling, a hall of fame and a benchmark arena that tells whether evolution is actually learning
(plan §2.5, §4 Sprint 3.2).

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | `config.ts`: `evolution` section (fitness weights, `maxAlliesHelped`, selection mode, parent fraction, tournament size, elites, crossover switch, mutation rate/σ, weight clamp, initial weight range, tribe-score weights, extinction mode, hall-of-fame size, benchmark interval + seed), all hashed | Every GA number is config-driven (`CLAUDE.md`) |
| 2 | Creatures own a `genome`; `World` gets `generationTick`, `isGenerationOver()` and `startGeneration(generation, spawns)` (food back to full, creatures cleared, ids restart at 0, seeded spawn in each tribe's zone) | Unit tests: reset restores food, spawns the requested counts in the right zones, ids are `0..n-1`, generation ends at `generationLength` or when everyone is dead |
| 3 | `fitness.ts`: `fitness = w·ticksAlive + w·foodEaten + w·waterDrunk + w·min(alliesHelped, cap) + w·kills`; tribe score = survivors + food gathered + territory (0 until 4.1) | **Exploit tests:** EAT/DRINK spam earns no more than metabolism burned (nothing at full stats); an only-`STAY` creature dies well before the generation ends (≤ 600 ticks on every preset, plan §2.3); ATTACK/SHARE spam earn nothing; `alliesHelped` is capped; dead creatures earn no survivor score |
| 4 | `genome.ts`: random initial genomes, engine-exact Gaussian noise, per-hidden-neuron crossover (switchable), mutation with clamp | Unit tests for each operator; only `rng.evolution` is drawn from |
| 5 | `evolution.ts`: ranking (ties → lower id), truncation or tournament parents, elitism, breeding per tribe, tribe-size allocation (proportional to tribe score, clamped to `[minTribeSize, popCap]`, exact total), extinction (respawn at `minTribeSize` from members + hall of fame, or battle royale elimination), hall of fame (top K by benchmark score), `EvolutionRun` driver | Unit tests per rule; two runs with the same seed give the same hash |
| 6 | `benchmark.ts`: fixed-seed arena — the champion's clones forage alone in tribe 0's start zone of a fixed map; score = mean fitness | Deterministic; a forager scores above a STAY-only brain |
| 7 | **Evolution test:** Small map, fixed seed, benchmark score at generation 50 > generation 1 | Passes in `pnpm test` |
| 8 | `SIM_VERSION` 4 → 5 (generation reset is a new tick rule; genomes and `generationTick` join the world hash); golden hashes re-recorded; new golden evolution scenario (Node + Chromium) | Same hashes in both engines |
| 9 | Docs: this file, `phase-3.md`, plan revision note for decisions taken | — |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`, `pnpm test:e2e` pass
  locally and in CI.
- Every fitness term has an exploit test; every new rule has a unit test (`CLAUDE.md`).

## Out of scope

- Trainer CLI, saving runs, viewer playing evolved genomes — Sprint 3.3. The viewer keeps the
  random policy until then.
- Tuning for clearly visible learning (the 2× bar) — Sprint 3.4.
- Combat, sharing, territory (their fitness terms stay 0) — Sprint 4.1.
- Lineage / family tree (`parentIds`) — Sprint 6.3.
- Continuous mode (births, no reset) — open decision, §10.

## Design notes

- **Driver, not tick rule, owns evolution.** `World.tick()` stays one simulation tick; an
  `EvolutionRun` wraps a `World`, calls `tick()`, and runs generation end when
  `world.isGenerationOver()` (or, in battle royale, when one tribe is left). The viewer keeps
  calling `world.tick()` until it switches to the run in 3.3.
- **Creature ids restart at 0 every generation**, so `world.creatures[id]` stays the creature
  (the enemy-adjacent sensor relies on it). `(generation, id)` identifies a creature in a run.
- **Gaussian noise without `Math.log`/`cos`:** Box–Muller is off limits (plan §3.3), so mutation
  noise is the Irwin–Hall sum of 12 uniforms minus 6 (mean 0, variance 1, bounded at ±6σ), using
  only `+`/`−`. The ±4 clamp makes the missing far tails irrelevant.
- **Crossover per hidden neuron:** each hidden neuron's incoming and outgoing slices come from one
  parent (coin flip per neuron); the 9 output biases, which belong to no hidden neuron, come from
  one parent with one more coin flip.
- **Benchmark arena:** a fixed map (preset of the run, seed `evolution.benchmarkSeed`), the
  champion cloned `startingCreaturesPerTribe` times into tribe 0's start zone, alone, for one
  generation. Score = mean fitness of the clones, so it measures the genome, not one lucky spawn.
  Run at generation 1 and every `benchmarkInterval` generations.
- **Extinct tribes (respawn mode)** breed from a candidate list of hall-of-fame genomes (best
  benchmark first) followed by this generation's members (best fitness first); elitism and
  truncation apply to that list, so the hall of fame's best come back unchanged.
- **Tribe sizes:** largest-remainder apportionment of the creature budget
  (`tribeCount × startingCreaturesPerTribe`) by tribe score, with tribes clamped to
  `[minTribeSize, popCapPerTribe]` and the rest re-split until stable; ties → lower tribe id.
  Extinct tribes get `minTribeSize` when another tribe survived; if every tribe went extinct, the
  budget is split by tribe score as usual so the population doesn't shrink. Eliminated (battle
  royale) tribes get 0.

---

## What was done

All nine backlog items, on branch `sprint-3.2`.

**New in `packages/sim-core/src/`**
- `fitness.ts`: `creatureFitness` (config weights, `alliesHelped` capped by `maxAlliesHelped`),
  `tribeOutcome` (survivors, food gathered, territory 0) and `tribeScore`.
- `genome.ts`: `randomGenome`, `gaussian` (Irwin–Hall), `crossoverPerNeuron` (one coin per hidden
  neuron + one for the output biases), `mutateGenome` (one coin per weight, Gaussian × σ, clamp).
- `evolution.ts`: `rankByFitness`, `pickParent` (truncation / tournament), `breedGenomes` (elites,
  crossover or copy, mutation), `allocateTribeSizes` (clamped largest-remainder split),
  `addToHallOfFame`, `isBenchmarkGeneration`, and `EvolutionRun` (`tick`, `runGeneration`,
  `benchmark`, `hash`, per-tribe `history` of `GenerationStats`, `finished`/`winner` for battle
  royale).
- `benchmark.ts`: `createBenchmarkArena` (map generated once from `benchmarkSeed`) and
  `runBenchmark`.

**Changed:** `config.ts` (`evolution` section, all hashed in `hashConfig`), `creature.ts`
(`genome`, `EMPTY_GENOME`), `world.ts` (`generationTick`, `isGenerationOver`, `startGeneration`,
zone tiles cached per tribe; the initial spawn uses the same path and draw order),
`hash.ts` (genomes and `generationTick` in the world hash), `SIM_VERSION` 4 → 5.

**Golden hashes:** random-policy and brain world hashes re-recorded for simVersion 5. The
forward-pass digest (`brainOutputs`) did not change, which shows sensors and brains behave exactly
as before; only the hash contents and the new generation rules changed. New `evolution` scenario:
`run.hash()` at the start of generations 2, 3 and 4 (random initial genomes, GA, tribe sizes,
benchmark arena, hall of fame), identical in Node and Chromium.

**Tests:** `fitness.test.ts` (10, the exploit tests), `genome.test.ts` (7), `evolution.test.ts`
(27: ranking, selection, breeding, allocation, hall of fame, world reset, run driver, RNG stream
isolation, determinism, extinction, all-extinct, battle royale, benchmark arena),
`evolution-learns.test.ts` (acceptance), golden evolution scenario.

**Acceptance**

| Criterion | Result |
|-----------|--------|
| Benchmark at gen 50 > gen 1 (Small, seed 42) | Mean over both tribes 498.3 → 764.8 (+53%; tribe 0: 498.7 → 1,014.2, tribe 1: 497.9 → 515.4). The test also requires > 1.1× |
| EAT/DRINK spam earns nothing extra | 0 at full stats; otherwise credited only for what metabolism burned (≤ drain × ticks ÷ bite) |
| An only-STAY creature dies well before the generation ends | All die by tick ≤ 600 (Small: shortest generation 1,500); fitness = ticks alive only |
| ATTACK / SHARE spam earn nothing; `alliesHelped` capped | Equal to STAY-only fitness; cap enforced |

**Speed** (Node 24, after `pnpm build`, includes generation ends and benchmark runs): Small,
50 generations = 72,664 ticks in 2.2 s (≈ 32,000 ticks/s, target > 2,000); Medium, 5 generations in
0.5 s (≈ 9,300 ticks/s; early generations die young, so few creatures per tick).

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (31 files, 208 tests),
`pnpm test:browser` (6 tests in Chromium), `pnpm build`, `pnpm test:e2e` (7 tests) all pass.

## Retro

**Went well**
- Unchanged `brainOutputs` digest across the `SIM_VERSION` bump: a cheap, direct proof that the
  refactor (spawn path, creature genomes, hash contents) left sensing and deciding untouched.
- Driving generations from `EvolutionRun` kept `World` small and every GA rule a pure function
  with its own unit test; health-0 "doom" injection made extinction and battle royale testable
  without contrived maps.

**Surprises / learnings**
- First run learned almost nothing: with initial weights in ±1, outputs were dominated by bias and
  the slowly drifting energy/hydration inputs, so each creature did one thing forever (always EAT
  or always DRINK). A 4-seed sweep (Small, 50 generations) found ±2 makes sensors matter; mean
  benchmark rose on all 4 seeds (e.g. 498 → 765, 485 → 695). Tournament selection with ±2 looked
  even better (all 4 seeds, both tribes mostly), but the plan's default is truncation — left for
  Sprint 3.4 tuning.
- The plan's extinction rule shrank Medium to half its population whenever every tribe died
  (common in early generations): fixed by re-splitting by score in that case (plan revised).
- Fitness noise is large: a creature spawned next to water lives ~600 ticks drinking, one that
  isn't dies at ~470, regardless of genome. The benchmark arena's clone averaging is what makes
  gen-to-gen comparison meaningful.

**Notes for Sprint 3.3 (trainer)**
- `createEvolutionRun` + `runGeneration()` is the whole loop; `tribe.history` and
  `tribe.hallOfFame` are what to save (genome files need `hashConfig(config)` now).
- The viewer still runs the random policy; switching its worker to an `EvolutionRun` (or loading a
  saved generation) is 3.3's viewer item.
- One benchmark costs one generation of `startingCreaturesPerTribe` creatures per tribe; on Huge
  every `benchmarkInterval` generations that is 8 × 150 creatures × 4,000 ticks — fine in a worker
  thread, but worth timing.
