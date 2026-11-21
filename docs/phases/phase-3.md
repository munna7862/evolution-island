# Phase 3 — Brains & Evolution

> Source of truth: `docs/master-plan.md` §4 (Phase 3), §2.4 (brain), §2.5 (generations, fitness,
> selection, benchmark arena), §3.3 (determinism), §3.6 (performance targets), §8 (risks).

## Goal

Reach **Milestone M3 — "It learns!"**: creatures driven by small neural networks that evolve across
generations until they clearly seek food and water, measured by the benchmark arena rather than raw
fitness, with a headless trainer fast enough to tune with hundreds of generations.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 3.1 | Neural network brain | Fixed-topology 18 → 12 → 9 softsign MLP on a `Float32Array` genome (333 weights), argmax over all 9 actions (ties → lowest index), brain spec carried in genome files, brain-driven decision policy, cross-engine golden test, benchmark |
| 3.2 | Generations & genetic algorithm | Fitness from effective intake, selection, elitism, per-hidden-neuron crossover, mutation, per-tribe gene pools, tribe-size re-allocation, extinction handling, hall of fame, benchmark arena, exploit tests |
| 3.3 | Headless trainer CLI | `pnpm train ...`, multi-seed `worker_threads`, saved hall-of-fame genomes + stats, viewer loads a run |
| 3.4 | "It learns!" milestone | Tuning until benchmark score clearly rises on 3 seeds (bar fixed in the sprint plan) |
| 3.5 | Memory experiment | 2 memory neurons behind a config switch, genome migration with zero weights, A/B in the arena |

## Exit criteria (Phase 3 is done when)

1. A brain-driven world is deterministic: same seed + genomes → same state hash in Node and in the
   browser (golden test).
2. On a Small map with a fixed seed, the benchmark-arena score at generation 50 beats generation 1,
   and the exploit tests pass (spamming `EAT`/`DRINK` earns nothing extra; an only-`STAY` creature
   dies well before the generation ends) — Sprint 3.2.
3. The trainer meets the §3.6 targets for Small and Medium, and the viewer plays genomes from a run
   — Sprint 3.3.
4. Benchmark score clearly rising on 3 seeds, with gen 1 vs gen 100 recorded — Sprint 3.4.
5. Memory experiment decided and recorded (kept only if the A/B shows it helps) — Sprint 3.5.

## Architecture decisions taken in this phase

1. **Hidden-neuron-major weight layout (Sprint 3.1).** The genome stores, for each hidden neuron in
   turn, its incoming weights (one per input, the bias input last), then the hidden→output block
   with each hidden neuron's outgoing weights contiguous and the output biases as a final row. Each
   hidden neuron's weights therefore sit in two contiguous slices, which makes Sprint 3.2's
   per-neuron crossover two slice copies. Sprint 3.5's memory inputs can be added by growing each
   neuron's input slice with zero weights (genome migration, `CLAUDE.md`).
2. **Engine-independent forward pass.** Softsign `x / (1 + |x|)` (only `+`, `/`, `Math.abs`), float64
   accumulation in a fixed order, no `Math.tanh`/`exp` (plan §2.4, §3.3). Argmax runs over the 9
   action outputs, ties to the lowest index; NaN never wins.
3. **Brain spec = `{ formatVersion, inputs, hidden, outputs }`**, derived from config
   (`brain.hiddenNeurons`) plus the sensor and action counts. Genome files carry it with `simVersion`
   and the config hash (plan §3.3 "versioned files") and are refused when the spec or simVersion
   doesn't match, or the config hash when the caller asks (migration arrives with Sprint 3.5's
   first new input).
4. **Golden scenarios run in a real browser engine, not only Node.** Vitest browser mode (Playwright
   provider) runs the same golden-hash test in Chromium, covering sensors + forward pass, not just
   tick rules. Firefox/WebKit instances can be added to that project (plan Sprint 5.2).
5. **`EvolutionRun` drives generations (Sprint 3.2).** `World.tick()` stays one tick; the run
   wraps a world, ends generations (length reached, everyone dead, or one tribe left in battle
   royale) and restarts it with `World.startGeneration` (food full, creatures respawned in their
   zones, ids from 0). All GA randomness comes from `rng.evolution`, tribes in ascending id order.
6. **Engine-exact Gaussian.** Mutation noise is the Irwin–Hall sum of 12 uniforms − 6; Box–Muller
   needs `Math.log`/`cos` (plan §3.3).
7. **Benchmark arena = champion clones on a fixed map.** A fixed-seed map of the run's preset,
   `startingCreaturesPerTribe` clones in tribe 0's start zone, alone, one generation; score = mean
   clone fitness. Runs at generation 1 and every `benchmarkInterval` generations; the hall of fame
   keeps the top K champions by this score.

8. **Run folders (Sprint 3.3).** `run.json` (manifest with the full config), `stats.json` /
   `stats.csv` (per generation and tribe), `checkpoints/gen-NNNN/` with `checkpoint.json` and one
   genome file per hall-of-fame entry, written at generation 1, every N generations and the end.
   Checkpoints and stats are deterministic (timing only in `run.json`); every file carries
   `simVersion` and the config hash and is refused when they don't match.
9. **Playing a checkpoint = an `EvolutionRun` started from it.** Each tribe gets its saved size,
   creature i running hall-of-fame genome i mod K; the run evolves on afterwards. The same
   `checkpointStart()` (shared) serves the viewer worker and Node, so tests compare hashes across
   engines. It is not a replay: spawns and tick order come from a fresh world (replays: 5.2).

## Risks

| Risk | Mitigation |
|------|------------|
| Creatures don't learn anything (plan §8) | Food sensor fixed in the Phase 2 close-out; benchmark arena as the progress metric; tuning in 3.4 with the trainer from 3.3 |
| Forward pass differs between engines | Softsign only, fixed summation order, golden hashes checked in Node and Chromium |
| Brain cost dominates Huge maps | Allocation-free forward pass with reused scratch buffers; benchmark against the §3.6 budget in 3.1 |
| Tuning eats weeks (3.4) | Trainer first (3.3), multi-seed runs, timebox and record what was tried |
