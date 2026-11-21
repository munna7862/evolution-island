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

---

## Review

Independent review after the merge (PR #9), on branch `sprint-3.2-review`. Two real bugs fixed
(`SIM_VERSION` 5 → 6), the rest checked and left as is.

**Fixed**

1. **Extinct tribes stopped learning.** In respawn mode an extinct tribe bred from
   `[...hallOfFame, ...members]`. With truncation at 20 % of 30 candidates that is 5 hall-of-fame
   genomes + 1 member as parents, and both elites are hall-of-fame genomes — while the hall of
   fame only changes every `benchmarkInterval` generations. Early on nobody outlives a 1,500-tick
   generation, so "extinct" is the normal state, not a rare collapse: on Small seed 42 tribe 1 was
   extinct in 50 of 50 generations and its benchmark went 498 → 519 → 509 → 515 (this was the
   "almost all from tribe 0" in the acceptance margin). Now `respawnGenomes` returns the best
   hall-of-fame genome unchanged plus offspring of the tribe's own members (normal elites and
   selection); the hall of fame is the parent pool only when there are no members. Compared on
   29 Small seeds × 50 generations (shipped rule / members only / champion + members): tribes
   whose benchmark rose > 1.1× went 29/58 → 37/58 → 37/58, and the worst tribe per seed did best
   with the champion variant on the 20 fresh seeds (mean ratio 1.14 / 1.15 / 1.18), so the
   plan's "bred from members plus hall of fame" is kept in that form.
2. **`allocateTribeSizes` lost part of the budget.** It fixed low tribes at `min`, then the leader
   at `popCap`, and never gave the low tribes what the cap freed: scores 750/125/125/125 on
   Medium gave 100/25/25/25 = 175 although 100/34/33/33 fits the clamps (its own doc comment
   promised the full budget). Now it is an exact water fill — size = clamp(λ·score, min, popCap)
   with one λ found between neighbouring breakpoints — plus the same largest-remainder rounding.
   New tests: the two cases above, budgets outside the clamps, and a fast-check property (sizes
   within the clamps, exact total whenever feasible, higher score → not smaller).

Golden hashes re-recorded for simVersion 6. `brainOutputs` is unchanged (sensors and forward pass
untouched); the world hashes changed only because they include `SIM_VERSION`; the evolution
scenario changed because generation 1 on seed 42 ends with every tribe extinct.

Acceptance after the fix (Small, seed 42): mean benchmark 498.5 → 768.0 at generation 50
(+54 %; tribe 0: 498.7 → 569.3, tribe 1: 497.9 → 966.7). The win moved from tribe 0 to tribe 1:
on one seed per-tribe progress is still a coin toss, which is why Sprint 3.4's bar is multi-seed.

**Checked, no change**

- `initialWeightRange` = 2: re-swept with the fix on 12 new seeds (Small, 50 generations): tribes
  > 1.1×: ±1 15/24, ±2 17/24, ±3 18/24. ±2 stays; part of the original "±1 barely learns" was
  the respawn freeze above. Worth a proper sweep with the trainer in 3.4.
- Acceptance test (> 1.1× of the mean): deterministic and honest for the plan's criterion, but
  tied to this config and seed — any 3.4 tuning change will move it. Fine as a regression guard.
- All-extinct rule (split by score): sound. The remaining population drop — one tribe alone
  survives on Medium, three extinct tribes at 25 + the leader at the cap of 100 = 175 — follows
  from the plan's own rules (12–14 of the first 25 generations on Medium seeds 1 and 42); noted in
  the plan for 4.2.
- Benchmark arena: deterministic (own world from `benchmarkSeed`, same spawns and shuffle every
  call, no run stream touched); clones share one read-only genome; ends early when all die.
- Irwin–Hall noise (12 uniforms − 6, `+`/`−` only), one mutation coin per weight, per-neuron
  crossover + one coin for the output biases, ids restarting at 0: correct and tested.
- Determinism: all GA draws from `rng.evolution` in ascending tribe order; ties by id (ranking),
  by index (remainders), by generation (hall of fame); all sorts are stable `Array.prototype.sort`.
- Exploit tests exist for every fitness term (`ticksAlive`: STAY-only dies ≤ 600 ticks;
  `foodEaten`/`waterDrunk`: spam credited only for burned metabolism; `alliesHelped`: cap and
  SHARE spam; `kills`: ATTACK spam) and for the tribe-score terms.

**Leads (not fixed here)**

- Tribe score is absolute, so a tribe at `popCap` out-scores equally good smaller tribes and
  tends to stay at the cap (Medium: 100/25/25/25 for many generations). Per-member scoring is a
  Sprint 4.2 balance question (plan §2.5 note).
- `foodEaten` credits energy actually regained, so moving (which costs energy) and then eating
  earns more food fitness than eating in place. That is foraging, not an exploit, but watch for
  pointless back-and-forth moves on food tiles in 3.4.
- Battle royale ends at the first generation where all tribes but one die — which, early on, is
  generation 1. The 4.2 battle-royale criterion will need a grace period or a later switch-on.
