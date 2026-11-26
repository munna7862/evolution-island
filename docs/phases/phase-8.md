# Phase 8 — NEAT brains (optional)

> Source of truth: `docs/master-plan.md` §4 (Phase 8), §2.4 (brain), §2.5 (evolution).

## Goal

Replace the fixed-topology MLP with NEAT (the topology evolves too) and compare learning speed
against v1. ✅ Benchmark-arena comparison NEAT vs MLP over 3 seeds, written up in `docs/`.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 8.1 | NEAT brains & comparison | NEAT behind `brain.kind` (genomes, forward pass, crossover, structural mutation, historical markings), golden + resume tests, 3-seed comparison in `docs/neat-vs-mlp.md` |

## Exit criteria

1. NEAT runs deterministically (golden hashes in Node and the browsers, exact resume) — 8.1.
2. The comparison is written up — 8.1.

## Architecture decisions taken in this phase

1. **NEAT genomes are flat `Float32Array`s (brain format 2).** Node ids and flags are whole numbers
   (exact in float32), so run files, replays, hashes, the family tree and the viewer handle NEAT
   genomes unchanged; `validateGenome` dispatches on the format.
2. **Historical markings without run state.** A connection is its (from, to) pair; a hidden node
   records the connection it split. At each breeding a `NeatRegistry` is rebuilt from the genomes
   alive (members and halls of fame), so the same split gets the same id across the run and a
   resumed run rebuilds the same registry — no innovation counter to save.
3. **Tribes are the species.** Each tribe already breeds only within itself; NEAT's speciation
   inside a tribe is left out. Crossover keeps the fitter parent's structure, so a child is always
   acyclic.
4. **Breeding goes through `GenomeOps`** (random, crossover, mutate) for both brain kinds; the MLP
   operators draw exactly as before (state hashes identical to `main`).
