# NEAT vs MLP: benchmark-arena comparison (Phase 8)

Plan §4 Phase 8: replace the fixed MLP with NEAT (evolving topology) and compare learning speed.
✅ Benchmark-arena comparison over 3 seeds, written up here.

## Setup

- **Runs:** Small map, held-out seeds 801–803 (never used for tuning), 100 generations, default config (`simVersion` 15, memory on, climate on). The only difference between the two arms is `brain.kind`:
  - **MLP:** 20 inputs → 12 hidden → 11 outputs, 383 weights, per-neuron crossover.
  - **NEAT:** starts with all 220 input→output connections and evolves structure; caps of 24 hidden nodes and 400 connections. Add-connection, add-node and toggle rates are 0.1 / 0.05 / 0.005.
  - Both arms share the same weight mutation (rate 0.05, σ 0.6, clamp ±4), tournament selection, 2 elites and hall of fame.
- **Score:** each tribe's champion is benchmarked in the fixed arena (Small, `benchmark-arena` seed, no natural climate) at generation 1 and every 10 generations. Scores below are the mean over the 2 tribes.
- `pnpm train --preset small --seeds 801-803 --generations 100`, once with `--config {"brain":{"kind":"neat"}}`.

## Results

Mean arena score of the 2 tribes' champions:

| Run | g1 | g10 | g20 | g30 | g40 | g50 | g60 | g70 | g80 | g90 | g100 | late (80–100) | late ÷ g1 |
|-----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|------|---------------|-----------|
| MLP 801 | 592 | 581 | 603 | 588 | 541 | 592 | 1317 | 1660 | 1268 | 1593 | 2007 | 1622 | 2.74 |
| MLP 802 | 602 | 653 | 542 | 916 | 1658 | 1523 | 1902 | 2001 | 2213 | 2255 | 1653 | 2040 | 3.39 |
| MLP 803 | 688 | 1238 | 1432 | 1069 | 1585 | 1604 | 859 | 1617 | 1949 | 2225 | 2166 | 2113 | 3.07 |
| NEAT 801 | 561 | 581 | 689 | 1186 | 1087 | 1090 | 1326 | 1727 | 1523 | 1791 | 1909 | 1741 | 3.10 |
| NEAT 802 | 584 | 761 | 1221 | 1284 | 1443 | 1427 | 1445 | 1196 | 1472 | 1265 | 1622 | 1453 | 2.49 |
| NEAT 803 | 649 | 553 | 890 | 1049 | 1036 | 1105 | 914 | 1078 | 1410 | 1549 | 1755 | 1571 | 2.42 |

Means over the 3 seeds:

| | g20 | g30 | g40 | g50 | late (80–100) | late ÷ g1 | first generation ≥ 2× g1 (per seed) |
|---|---|---|---|---|---|---|---|
| MLP | 859 | 858 | 1262 | 1240 | **1925** | **3.07** | 60, 40, 20 |
| NEAT | **933** | **1173** | 1189 | 1208 | 1588 | 2.67 | 30, 20, 80 |

**Structure NEAT grew:** the generation-100 champions have 0–8 hidden nodes (6, 1, 4, 3, 0, 8), 220–237 connections, and about a quarter of their connections switched off. They are close to linear networks with a few hidden units.

**Speed:**
- Per creature-tick NEAT costs about 1.2–1.5× the MLP's CPU time here: the compiled network uses per-connection index lookups instead of the MLP's dense loops.
- In the worst-case benchmark (everyone alive) the two were within timing noise.
- The 3× slower wall-clock training of the NEAT runs above came mostly from machine load (the runs were sequential, with another program busy), so it is not a property of NEAT.

## Conclusion

**No clear winner over 3 seeds.**
- NEAT tends to improve sooner: its mean is ahead at generations 20–30, and it reached 2× its generation-1 score first on 2 of 3 seeds. Starting as a linear input→output network, it has fewer weights to get right before simple behaviours (drink when thirsty, eat when on food) pay off.
- The MLP ends higher: its late score is ahead on 2 of 3 seeds, with a 1.21× higher mean.
- Three seeds can't separate these from the run-to-run noise. The per-seed curves cross several times, as in every earlier sprint's measurements.

**Decision:** the MLP stays the default brain, and NEAT is available with `brain.kind: "neat"`. Replacing the MLP would need evidence that NEAT is better, and this comparison doesn't give it.

**What would help NEAT next (not done):**
- Speciation inside tribes, to protect new structure while its weights are still poor.
- A lower toggle rate: a quarter of the connections ended disabled.
- More seeds and longer runs, to tell an early-speed advantage from noise.
