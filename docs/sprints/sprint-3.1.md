# Sprint 3.1 — Neural network brain

- **Phase:** 3 — Brains & Evolution (`docs/phases/phase-3.md`)
- **Branch:** `sprint-3.1`
- **Personas:** ML / Evolution Engineer (network, genome layout, spec), Simulation Architect
  (determinism, allocation-free hot path), SDET (forward-pass tests, cross-engine golden test,
  benchmark)

## Goal

A fixed-topology MLP brain that turns the 18 sensors into one of the 9 actions, deterministically in
every JS engine, with its shape recorded in genome files (plan §2.4, §4 Sprint 3.1).

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | `config.ts`: `brain.hiddenNeurons = 12` (hashed) | Brain size is config-driven |
| 2 | `brain.ts`: `BrainSpec`, `brainSpecFromConfig`, `weightCount`, layout offsets | 18 → 12 → 9 gives 333 weights (plan §2.4); 23 → 12 → 12 gives 432 |
| 3 | `brain.ts`: allocation-free `forwardPass` (softsign hidden, linear outputs) and `argmaxAction` | Hand-computed networks match exactly; ties → lowest index; NaN never wins; `ATTACK`/`SHARE` may be chosen and resolve as `STAY` (Sprint 4.1 turns them on) |
| 4 | `brain.ts`: `createBrainPolicy(spec, genomeFor)` | Reads sensors, runs the brain, returns the action; ignores the RNG; validates genome length |
| 5 | `shared/genome-file.ts`: serialize / parse genome files carrying `simVersion` + config hash + brain spec | Round-trips bit-exactly; refuses wrong format, mismatched spec, wrong weight count, non-finite weights |
| 6 | `SIM_VERSION` 3 → 4 (brain spec v1 introduced) | Golden hashes re-recorded with the bump |
| 7 | Golden brain scenario (fixed closed-form genome) in Node **and** in Chromium via Vitest browser mode; CI runs it | Same hashes in both engines; covers sensors + forward pass (close-out follow-up) |
| 8 | Benchmark: forward passes/sec and a full Huge tick with 1,400 brain-driven creatures | Recorded against the §3.6 budget (Huge trainer > 150 ticks/s ⇒ < 6.7 ms/tick) |
| 9 | Docs: `phase-3.md`, this file, plan revision note if a decision changes | — |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`, `pnpm test:e2e` pass
  locally and in CI.
- Every new rule has a unit test (`CLAUDE.md`); benchmark numbers recorded below.

## Out of scope

- Fitness, selection, crossover, mutation, generations, benchmark arena — Sprint 3.2.
- Per-creature genomes owned by tribes/gene pools — Sprint 3.2 (3.1's policy takes a genome lookup).
- Genome migration (zero weights for new inputs) — Sprint 3.5, the first sprint that adds inputs.
- Viewer UI for brains — Sprint 3.3 (load genomes from a run) and 6.2 (brain activation view).

## Design notes

See `docs/phases/phase-3.md` → "Architecture decisions" (layout, engine-independent math, spec,
golden in a real browser).

---

## What was done

All nine backlog items, on branch `sprint-3.1`.

**`packages/sim-core/src/brain.ts`** (new)
- `BrainSpec { formatVersion, inputs, hidden, outputs }`, `BRAIN_FORMAT_VERSION = 1`,
  `brainSpecFromConfig` (18 sensors, `config.brain.hiddenNeurons = 12`, 9 actions),
  `validateBrainSpec`, `sameBrainSpec`, `weightCount` (333 for v1; 432 for 23 → 12 → 12).
- Hidden-neuron-major layout with index helpers `inputWeightIndex`, `outputWeightIndex`,
  `outputBiasIndex`; `createZeroGenome`, `validateGenome` (length + finiteness).
- `forwardPass`: allocation-free (reused `Float64Array` scratch), softsign hidden layer, linear
  outputs, float64 sums in a fixed order. `argmaxAction`: first 9 outputs, ties → lowest index, NaN
  never wins, nothing finite → `STAY`.
- `createBrainPolicy(spec, genomeFor)`: sensors → forward pass → argmax; never draws from the policy
  RNG; checks spec fit at creation and genome length per call.

**`packages/shared/src/genome-file.ts`** (new): `serializeGenome` / `parseGenome` (JSON with
`format`, `fileVersion`, `simVersion`, `configHash`, brain spec, weights) and
`assertGenomeCompatible` (refuses a different brain shape or simVersion, and a different config
hash when the caller passes one, with a typed `GenomeFileError` reason). Every float32 weight
round-trips exactly.

**Config & version:** `brain.hiddenNeurons` added to `SimConfig` and `hashConfig`;
`SIM_VERSION` 3 → 4. The golden test caught the config-hash change before the bump, as designed.

**Golden hashes** now cover two scenarios on Small / seed 42: the random policy (tick rules) and a
fixed closed-form brain genome for every creature (adds sensors + forward pass; all 50 creatures die
by tick 600, so deaths are covered too), plus a running digest of every sensor vector and raw
forward-pass output in that brain scenario (added in review, below). `golden-hash.test.ts` runs in
Node (`pnpm test`) **and
inside Chromium** through Vitest browser mode (`pnpm test:browser`, new `vitest.browser.config.ts`,
`@vitest/browser-playwright`); both produce identical hashes. CI's browser job now runs
`pnpm test:browser` before the viewer e2e tests. This closes the Phase 2 close-out follow-up.

**Benchmark** (`node packages/sim-core/test/brain.bench.ts`, Node 24, after `pnpm build`; two runs):

| Measure | Result | Plan §3.6 target |
|---------|--------|------------------|
| Forward pass alone (18-12-9) | 2.49–2.57 M evals/s (~390–400 ns) | Huge needs ≈ 0.18 M evals/s |
| Small, 50 creatures, full brain tick | 0.09–0.10 ms → ~9,600–10,800 ticks/s | > 2,000 |
| Medium, 200 | 0.38–0.59 ms → ~1,700–2,600 ticks/s | > 1,000 |
| Large, 480 | 0.60–0.65 ms → ~1,540–1,680 ticks/s | > 400 |
| Huge, 1,200 | 1.98–2.01 ms → ~500 ticks/s | > 150 |
| Huge, 1,400 (max tribe sizes) | 2.49 ms → ~400 ticks/s | > 150 |

A full tick includes regrowth, grid rebuild, sensors, forward pass, action resolution and
metabolism; generation-end work (Sprint 3.2) and trainer overhead (3.3) are not included yet.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (27 files, 158 tests),
`pnpm test:browser` (4 tests in Chromium), `pnpm build`, `pnpm test:e2e` (7 tests) all pass.

## Retro

**Went well**
- The golden-hash guard paid off on its first real change: adding `brain.hiddenNeurons` to the
  config hash failed the test immediately, forcing the `SIM_VERSION` bump instead of a silent drift.
- Vitest browser mode runs the *same* test file in Chromium with no viewer plumbing, which is a
  cleaner cross-engine check than routing a brain through the worker UI, and Firefox/WebKit are one
  config line each later.
- Headroom: the forward pass costs ~0.4 µs, so sensors (not the brain) remain the main per-creature
  cost; every preset clears its trainer target by 2.6–5× single-threaded.

**Surprises / learnings**
- `@typescript-eslint/no-confusing-void-expression` rejects `expect(() => voidFn()).toThrow()`;
  tests need braces around void calls (auto-fixable).
- pnpm 12 prints "Agent skills awaiting approval: pixi.js" on install. It's an optional AI-agent
  skill bundled with `pixi.js`; left unapproved, nothing in the project needs it.
- `-0` weights serialize as `0` in JSON; harmless because forward-pass sums start at +0, but worth
  knowing if genomes are ever hashed bit-for-bit.

**Notes for Sprint 3.2**
- `genome.ts` (plan §3.2) will hold crossover, mutation and migration; the brain spec ended up in
  `brain.ts` next to the forward pass that defines it.
- Creatures still get genomes through `createBrainPolicy`'s lookup; 3.2 should give each creature
  its own genome from its tribe's gene pool, with random initial weights from `rng.evolution`.
- Per-neuron crossover = copy `[h·I, (h+1)·I)` and `[H·I + h·O, H·I + (h+1)·O)` from one parent.

## Review

A second session reviewed the uncommitted sprint with fresh eyes against plan §2.4, §3.3, §4
Sprint 3.1, `CLAUDE.md` and `phase-3.md`, before the first commit.

**Checked, no change needed**
- Layout and index math: `inputWeightIndex` / `outputWeightIndex` / `outputBiasIndex` cover
  `[0, 333)` exactly once (permutation test), each hidden neuron's weights are two contiguous
  slices, 18 → 12 → 9 = 333 and 23 → 12 → 12 = 432 as in plan §2.4.
- Forward pass: softsign hidden, linear outputs, float32 × float32 products (exact in float64),
  sums in a fixed order, only `Math.abs` (passes the determinism lint). ECMAScript forbids fused
  multiply-add, so engines cannot reorder or contract the sums.
- Argmax: only the first 9 outputs, ties → lowest index, NaN never wins, nothing finite → `STAY`;
  `Action` values equal the output indices.
- `createBrainPolicy`: never touches the policy RNG (tested), checks spec fit once and genome length
  per call. `SIM_VERSION` 3 → 4 is justified (config hash changed).
- Genome parsing: wrong format/version, missing fields, non-integers, invalid spec, wrong length,
  non-numbers, `null` (NaN) and values that overflow float32 are all refused as `malformed`.
- CI: the browser job installs Chromium for Playwright 1.65.1, the same version the root
  `playwright` dependency of `@vitest/browser-playwright` uses, then runs `pnpm test:browser`.

**Found and fixed**
1. **The golden brain scenario barely pinned the forward pass.** World hashes only see the argmax,
   and the golden genome mostly picks DRINK (86% of intents; 49 successful moves in 600 ticks).
   Proof: adding `1e-15` to the softsign denominator left all four existing golden tests green.
   Fix: a new golden test hashes every sensor vector and every raw forward-pass output (float64
   bits) of that scenario (`GOLDEN.brainOutputs` at ticks 100 and 600), through a recording policy
   that is checked to produce the same world hashes as `createBrainPolicy`. The same `1e-15`
   mutation now fails it. Test-only: no behaviour change, so no
   `SIM_VERSION` bump and the existing hashes are unchanged.
2. **Genome files had no config hash,** though plan §3.3 says genomes carry `simVersion`, the brain
   spec *and* a config hash. Fix: `serializeGenome(brain, weights, configHash)` writes
   `configHash` (16 hex digits, checked on read); `assertGenomeCompatible(genome, { brain,
   simVersion?, configHash? })` refuses a different config with reason `config-hash-mismatch`
   when the caller passes one. Opt-in, because a brain is still runnable under a tuned config;
   Sprint 5.1 decides when runs must match. Still `fileVersion` 1 (nothing was ever written).
3. Docs: the golden genome's comment claimed "varied" reactions; it now states the actual action
   mix. Backlog item 5 and phase-3 decision 3 mention the config hash.

**Note for Sprint 3.2:** the output biases (last 9 weights) belong to no hidden neuron, so
per-neuron crossover must also pick them from one parent (or per output).

**Verification after review:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (27 files, 162 tests),
`pnpm test:browser` (5 tests in Chromium), `pnpm build`, `pnpm test:e2e` (7 tests) all pass.
