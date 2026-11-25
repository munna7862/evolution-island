# Sprint 3.5 — Memory experiment

- **Phase:** 3 — Brains & Evolution (`docs/phases/phase-3.md`)
- **Branch:** `sprint-3.5`
- **Personas:** ML / Evolution Engineer (memory neurons, migration, A/B design), Simulation
  Architect (tick rules, determinism, `SIM_VERSION`), Game Designer (sparse-water variant), SDET
  (unit and property tests, acceptance measurements)

## Goal

Give creatures 2 memory neurons (plan §2.3 "Memory & signals", §2.4) behind a config switch, added
through genome migration with zero weights, and find out with an A/B in the benchmark arena whether
memory helps: on the normal Small map and on a sparse-water variant, where water is often out of
sight and remembering where it was should matter most. Keep memory only if the A/B says it helps
(plan §4 Sprint 3.5, §8 "Memory or signals add complexity without helping").

## Starting point (`main` at `15f1c42`, `SIM_VERSION` 8)

Sprint 3.4 reached "it learns!": on 20 held-out Small seeds the mean generation-100 / generation-1
benchmark ratio is 2.52, 16 of 20 seeds reach 2× generation 1 and 2× a STAY-only brain, 30 of 40
tribes reach 1.5×. Generation-100 champions walk to the shore and stay there; foraging trips away
from water are rare. Known limitations: hard lock-in ("always EAT"/"always DRINK", 2 of 40
held-out tribes) and champion noise (8 more tribes below 1.5× whose generation-100 champion scored
low although the tribe had bred creatures that lived through whole generations).

## Design

- **Switch:** `brain.memoryNeurons` in `config.ts` (0 = off; the experiment uses 2, and after the A/B
  it is the default). In the config hash; a whole number in `--config` files.
- **Brain spec:** inputs = 18 sensors + M memory inputs, outputs = 9 actions + M memory outputs.
  The memory inputs come after the bias (sensor indices 0–17 unchanged), the memory outputs after
  the 9 actions. With M = 2: 20 → 12 → 11 = 20·12 + 13·11 = **383 weights** (plan §2.4 gives 432
  with signals as well). Argmax still runs over the 9 action outputs only.
- **Memory values:** each creature carries `memory` (M float32 values, 0 at spawn). In Phase A the
  brain policy reads them as inputs, then stores the squashed memory outputs (softsign, so always
  within −1..1) as the creature's new memory, sensed on the next tick (plan §2.3). A creature reads
  only its own memory, and reads it before writing it, so no separate commit step is needed (calls
  in Sprint 4.3 will need one: allies hear them).
- **Migration:** `migrateGenome(from, to, weights)` copies every weight of a smaller brain into a
  brain with more inputs and/or outputs (same hidden size) and gives the new ones weight 0. A
  migrated memory-off genome never writes anything but 0 to memory and never reads it, so it acts
  exactly as before.
- **State hash:** `hashWorld` adds each creature's memory. A new `hashWorldState` hashes only what
  evolves during a run (ticks, food, RNG streams, creatures' positions, stats and actions), not the
  config hash, genomes or memory, so two worlds under different brain configs can be compared
  (the migration test).
- **`SIM_VERSION` 8 → 9:** the brain spec can change, the tick has a new rule (memory), and the
  world hash covers memory. Behaviour with memory off is unchanged (same benchmark scores and
  champion behaviour as `SIM_VERSION` 8), but golden hashes change because the hash covers more.
  **9 → 10** after the A/B: memory on by default.

## A/B design

- **Arms:** memory off (`brain.memoryNeurons` 0) vs on (2), everything else the shipped defaults,
  trained from scratch with `pnpm train`. Both arms use the same seeds, so each pair shares its
  maps; their genomes differ from generation 1 on (383 vs 333 random weights).
- **Maps:** the normal Small preset, and a sparse-water variant made only with `--config`
  (`docs/sprints/sprint-3.5/sparse-water.json`; with memory: `sparse-water-memory-on.json`). The
  benchmark arena uses the same variant, because its map comes from the run's config.
- **Config files** in `docs/sprints/sprint-3.5/`: `memory-on.json`, `memory-off.json`,
  `sparse-water-memory-on.json`, `sparse-water-memory-off.json` name the memory switch
  explicitly; `sparse-water.json` is the map variant alone (memory follows the default, which was
  off when the bar was fixed and is on since the result).

**Sparse-water variant.** Map generator settings only: `shallowWaterThreshold` −0.08 → −0.22 (no
shallow water from the noise, only ponds and deep-water shores), `islandCoreLift` 0.14 → 0.3 (fewer
inland lakes), ponds smaller (`pondRadius` 2.05 → 1.5) and farther from the spawn centre
(`pondDistanceRatio` 0.72 → 1.3), placed only when a spawn has fewer than 6 drinkable water tiles
within its fairness radius (`targetFairnessWaterTiles` 12 → 6, `minFairnessWaterTiles` 6 → 3).
Measured on seeds 1–40 (scratch script over the generated maps, vision radius 8):

| Map | Spawn-zone tiles with water in sight | Mean distance to water from the spawn zone | Land with water in sight | Arena: in sight / distance | Arena: DRINK-only brain |
|---|---|---|---|---|---|
| Normal Small | 99 % | 2.6 tiles | 99 % | 100 % / 1.7 | 561 |
| Sparse water | 70 % | 6.6 tiles | 85 % | 68 % / 6.8 | 515 (= STAY-only: no clone spawns next to water) |

So on the normal map water is almost never out of sight, and memory can only help with something
else; on the sparse map a third of the spawn zone can't see water and the rest sees it 2.6× farther
away.

**Development runs (memory off only, seeds 1–40; no memory-on run before the bar was fixed).**
They sized the bar and picked the variant. "Late" = mean of a tribe's last three benchmarks.

| Map, generations | Seeds | Gen 1 → late (mean) | Mean ratio (final / gen 1) | Tribes ≥ 1.5× | Hard lock-in | Two halves of 20 seeds differ by (5th–95th pct.) |
|---|---|---|---|---|---|---|
| Normal, 100 | 1–40 | 607 → 1,388 | 2.34 (1–20: 2.41, 21–40: 2.26, as in Sprint 3.4) | 69 / 80 | 0 | −8 % … +9 % |
| First sparse try (spawn ring 10 as well), 100 | 1–40 | 535 → 635 | 1.20 | 10 / 80 | 34 | −10 % … +11 % |
| … same, 300 | 1–20 | 536 → 773 (gen 300) | 1.44 | — | — | — |
| Sparse water (chosen), 100 | 1–20 | 561 → 749 (gen 100) | 1.34 | 12 / 40 | 12 | — |
| Sparse water (chosen), 300 | 1–40 | 546 → 1,035 | 1.92 | 45 / 80 | 9 | −13 % … +15 % |

The first, drier variant (spawn ring 14 → 10 too: water in sight from 53 % of spawn tiles, 7.5
tiles away) was too hard: memory off barely learned even in 300 generations, and with 34 of 80
tribes locked in there would be little left to compare. With the chosen variant memory off still
learns slowly (no plateau at generation 100), so the sparse arms run **300 generations**.

## Acceptance bar (fixed before the held-out run)

Chosen by the user on 2026-11-25, before any held-out seed was run and before memory-on had been
trained on any seed. The plan's "≥ 2 of 3 seeds" would mostly measure luck (Sprint 3.4).

Measured **once** per arm on held-out Small seeds **201–250** (never used before), with the
shipped `DEFAULT_CONFIG` plus only the files named:

```
pnpm train --preset small --seeds 201-250 --generations 100 --out runs/s35-normal-off
pnpm train --preset small --seeds 201-250 --generations 100 --config docs/sprints/sprint-3.5/memory-on.json --out runs/s35-normal-on
pnpm train --preset small --seeds 201-250 --generations 300 --config docs/sprints/sprint-3.5/sparse-water.json --out runs/s35-sparse-off
pnpm train --preset small --seeds 201-250 --generations 300 --config docs/sprints/sprint-3.5/sparse-water-memory-on.json --out runs/s35-sparse-on
```

- **Tribe score** = the mean of its last three benchmark-arena scores in `stats.csv`
  (generations 80/90/100; sparse 280/290/300). Averaging three champions damps the champion
  noise seen in Sprint 3.4 (a single generation-100 champion moved tribes across the bar).
- **Seed score** = mean of its 2 tribes; **arm score** = mean of its 50 seed scores.

Memory passes only if all three hold:

1. **Normal map, not worse:** memory-on arm score ≥ **0.95 ×** memory-off.
2. **Sparse map, better:** memory-on arm score ≥ **1.10 ×** memory-off.
3. **Sparse map, on most seeds:** memory-on's seed score beats memory-off's on **≥ 30 of 50**
   seeds (same seed = same maps).

Why these thresholds: between two memory-off arms of 20 seeds the arm scores differed by −8 … +9 %
(normal) and −13 … +15 % (sparse), 5th–95th percentile of random splits of the development
seeds; with 50 seeds per arm that is about ±6 % and ±9 %. A memory that does nothing would then
fail condition 1 about 7 % of the time and pass condition 2 about 4 % of the time; condition 3
alone (a coin flip per seed) passes 10 % of the time. A real +20 % on the sparse map would pass
condition 2 about 95 % of the time.

**Reported per arm, not blocking:** mean ratio (final generation / generation 1), tribes ≥ 1.5×
generation 1; **hard lock-in** = tribes whose best creature's world fitness stayed below 700 in
each of the last 10 generations (an always-EAT or always-DRINK tribe dies at tick ~530; nobody
finds water); **champion noise** = tribes below 1.5× that are not hard lock-ins, the mean
|final-generation benchmark − tribe score| / tribe score, and the mean spread of the three late
benchmarks.

**If memory passes:** `brain.memoryNeurons` becomes 2 in `DEFAULT_CONFIG` (user's decision, same
day): `SIM_VERSION` 10, golden hashes and the seed-42 regression test re-checked. **If it fails:**
memory stays off (the switch stays), and the retro says why.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file: design, backlog, definition of done | Written before coding |
| 2 | `brain.memoryNeurons` config switch (default 0), in the config hash and `--config` whole-number fields | Unit tests: spec sizes with 0 and 2, override validation |
| 3 | Brain spec with memory inputs/outputs; creature `memory`; brain policy feeds memory in and squashes memory outputs back | Unit tests: memory stays within −1..1 (property test, extreme weights, a whole generation); memory is fed back on the next tick |
| 4 | `migrateGenome` (zero weights for new inputs/outputs) | Unit tests: layout, a migrated genome gives the same state hash (`hashWorldState`) as before migration over a whole generation, memory stays 0, same benchmark score |
| 5 | `hashWorld` covers memory; `hashWorldState`; `SIM_VERSION` 9; golden hashes re-recorded | `pnpm test`, `pnpm test:browser`, `pnpm test:e2e` green |
| 6 | Sparse-water variant config (`--config`), measured: water in sight from the spawn zone, arena map | Numbers recorded below |
| 7 | Noise check (memory off only, tuning seeds) to size the bar; bar proposed to the user and fixed here and in the plan | Bar committed before any held-out run |
| 8 | A/B on held-out seeds, run once; lock-in and champion noise reported separately | Every seed's numbers recorded |
| 9 | Decision (keep / leave off), retro, `phase-3.md`, plan revision note | — |

## Definition of done

- Memory switch, migration and tests as above; `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:browser`, `pnpm build`, `pnpm test:e2e` pass locally and in CI.
- A/B run once on the held-out seeds against the bar fixed beforehand, every seed's numbers here.
- Decision recorded: memory kept (and how it is switched on) or left off, with the reason.

## Out of scope

- Signals / calls and the tribe-score fitness term — Sprint 4.3.
- Migrating saved runs or genome files across `SIM_VERSION`s, resuming runs — Sprint 5.1.
- Showing memory values in the viewer — the creature inspector, Sprint 6.2.
- Tuning anything other than the memory switch (the A/B keeps every other default).

---

## What was done

On branch `sprint-3.5`.

**Memory neurons** (commit `ff02e3f`, `SIM_VERSION` 9). `brain.memoryNeurons` in `config.ts` and
the config hash (whole number in `--config`); `brainSpecFromConfig` adds M inputs and M outputs,
`memoryNeuronCount` checks a spec's memory inputs match its memory outputs; creatures carry
`memory` (`createCreature`, `World.spawnCreature`); `createBrainPolicy` feeds sensors + memory in
and stores the squashed memory outputs (`storeMemoryOutputs`) back; `migrateGenome` (zero weights
for new inputs/outputs); `hashWorld` covers memory and `hashWorldState` leaves out config hash,
genomes and memory. Tests (`memory.test.ts`, 16): spec sizes and refusals; memory within −1..1 for
any finite output (property test), for any genome including weights of ±3.4·10³⁸ (property test
on a Small world), and through a whole generation of a memory-on run; memory read back exactly one
tick later (STAY on tick 1, EAT on tick 2 from a memory-driven hidden neuron); migration layout,
bit-identical action outputs for any inputs, refusals; **a migrated genome gives the same
`hashWorldState` every 50 ticks through a whole generation** (generation-21 genomes of a memory-off
run on seed 42, 1,568 ticks until all 50 are dead) with memory exactly 0 throughout, and the same
benchmark-arena score; memory-on evolution is deterministic. A pinned memory-on golden scenario
runs in Node and Chromium. With memory off, the sensor + forward-pass digest and the map hash were
unchanged, and seed 42 trained for 100 generations gave Sprint 3.4's numbers exactly (541/561 →
1,437/1,075).

**Bar first** (`b63fa99`). Sparse-water variant and development runs (memory off only) as above,
bar proposed, chosen by the user and committed before any held-out seed and before any memory-on
training run.

**Memory on by default** (after the result, `SIM_VERSION` 10). `DEFAULT_CONFIG.brain.memoryNeurons`
2 (reason in a comment); golden hashes re-recorded: the default-brain scenarios now include memory
(the recording policy feeds memory like the real one), and the memory-off brain stays pinned as
`noMemoryPolicy`; map hash unchanged. Two tests that hard-coded the 333-weight brain would have
kept passing for the wrong reason (a NaN forward pass on both sides of a `toEqual`; "malformed"
genome files refused for their length instead of the bad weight); they are now sized from the
spec. Memory-off config files added so every arm names its switch.

## Acceptance (held-out seeds 201–250, run once)

The four commands of the bar, run once at `b63fa99` (memory off by default then). Config hashes:
normal off `d3bfde7496ef23c1`, normal on `9efac4f2f94c0b20`, sparse off `25ae4542ce5610f5`, sparse
on `773fd45f4b8ac86e`. Scores from each seed's `stats.csv` (unrounded for the conditions).

| Condition | Needed | Result | |
|---|---|---|---|
| 1. Normal map: memory-on / memory-off arm score | ≥ 0.95 | 1,596 / 1,436 = **1.11** | pass |
| 2. Sparse map: memory-on / memory-off arm score | ≥ 1.10 | 1,599 / 955 = **1.67** | pass |
| 3. Sparse map: seeds where memory-on scores higher | ≥ 30 of 50 | **48 of 50** | pass |

**Memory passes, with a wide margin on every condition**, so it is now on by default (the user's
decision before the run). On the normal map, where water is in sight almost everywhere, memory-on
also scores higher on 35 of 50 seeds. On the sparse map it is better on all but seeds 209 and 218.

Per arm (reported, not blocking; "late" = tribe score, STAY-only arena score 515 on both maps):

| Arm | Gen 1 | Late | Final gen | Mean ratio final / gen 1 | Seeds ≥ 2× gen 1 and ≥ 2× STAY-only | Tribes ≥ 1.5× gen 1 | Hard lock-in | Below 1.5×, not locked in | Final vs late (mean abs. diff.) | Spread of the 3 late benchmarks |
|---|---|---|---|---|---|---|---|---|---|---|
| Normal, off | 593 | 1,436 | 1,506 | 2.54 | 44 / 50 | 88 / 100 | 3 | 9 | 17 % | 17 % |
| Normal, on | 595 | 1,596 | 1,652 | 2.81 | 46 / 50 | 94 / 100 | **0** | 6 | 15 % | 17 % |
| Sparse, off | 532 | 955 | 970 | 1.82 | 17 / 50 | 56 / 100 | 12 | 32 | 13 % | 15 % |
| Sparse, on | 535 | 1,599 | 1,655 | 3.10 | 48 / 50 | 88 / 100 | **3** | 9 | 17 % | 19 % |

- **Hard lock-in** (best creature below fitness 700 in each of the last 10 generations): memory
  cut it from 3 to 0 of 100 tribes on the normal map and from 12 to 3 on the sparse map.
- **Champion noise** did not change: in every arm a tribe's final-generation benchmark differs
  from its late mean by 13–17 % on average, and its three late benchmarks spread by 15–19 %. The
  tribes below 1.5× that are not locked in dropped (9 → 6, 32 → 9) because more tribes learned,
  not because champions got less noisy. Scoring tribes by three benchmarks, as this bar did, is
  the cheap remedy.

Every seed's late scores, tribe 0 / tribe 1 (seed score); † = hard lock-in:

| Seed | Normal off | Normal on | Sparse off | Sparse on | Sparse: on better |
|---|---|---|---|---|---|
| 201 | 1651 / 1042 (1347) | 1702 / 1367 (1535) | 1358 / 1154 (1256) | 1727 / 848 (1287) | yes |
| 202 | 533† / 1826 (1179) | 1842 / 1749 (1795) | 534† / 804 (669) | 2137 / 1464 (1800) | yes |
| 203 | 1815 / 531† (1173) | 2011 / 1160 (1586) | 537 / 1372 (955) | 1492 / 1272 (1382) | yes |
| 204 | 1454 / 1663 (1558) | 1627 / 1044 (1335) | 1021 / 771 (896) | 1196 / 2242 (1719) | yes |
| 205 | 1324 / 1695 (1510) | 1680 / 1852 (1766) | 537 / 543† (540) | 1882 / 1990 (1936) | yes |
| 206 | 1888 / 776 (1332) | 2067 / 754 (1410) | 683 / 800 (742) | 2515 / 699 (1607) | yes |
| 207 | 2018 / 1646 (1832) | 1808 / 1568 (1688) | 603 / 803 (703) | 2758 / 1511 (2134) | yes |
| 208 | 1578 / 1856 (1717) | 1986 / 2020 (2003) | 616 / 575 (596) | 1159 / 1631 (1395) | yes |
| 209 | 1268 / 1568 (1418) | 1476 / 829 (1153) | 1538 / 1594 (1566) | 1718 / 782 (1250) | no |
| 210 | 1351 / 1068 (1210) | 1690 / 1616 (1653) | 1648 / 819 (1234) | 1518 / 1719 (1618) | yes |
| 211 | 1553 / 1381 (1467) | 1706 / 2047 (1877) | 792 / 1425 (1108) | 1961 / 1397 (1679) | yes |
| 212 | 1387 / 1844 (1615) | 1732 / 1668 (1700) | 1308 / 750 (1029) | 1672 / 737 (1204) | yes |
| 213 | 1520 / 721 (1121) | 1602 / 1024 (1313) | 537 / 713 (625) | 2156 / 709 (1432) | yes |
| 214 | 1154 / 1341 (1247) | 1611 / 2021 (1816) | 1411 / 553 (982) | 2735 / 1470 (2103) | yes |
| 215 | 1411 / 1353 (1382) | 1276 / 1238 (1257) | 1874 / 820 (1347) | 673 / 2040 (1357) | yes |
| 216 | 1549 / 918 (1234) | 1595 / 1860 (1728) | 717 / 543† (630) | 1475 / 1041 (1258) | yes |
| 217 | 531† / 1753 (1142) | 1640 / 1762 (1701) | 1523 / 515† (1019) | 1392 / 1499 (1445) | yes |
| 218 | 1529 / 1995 (1762) | 2104 / 1653 (1879) | 939 / 1995 (1467) | 1305 / 1349 (1327) | no |
| 219 | 986 / 1506 (1246) | 1486 / 1328 (1407) | 1297 / 727 (1012) | 1406 / 1405 (1406) | yes |
| 220 | 908 / 1912 (1410) | 1738 / 1469 (1604) | 773 / 707 (740) | 996 / 1070 (1033) | yes |
| 221 | 1471 / 1161 (1316) | 1345 / 1658 (1502) | 1212 / 861 (1037) | 2028 / 1074 (1551) | yes |
| 222 | 709 / 1044 (877) | 1634 / 1791 (1713) | 1167 / 1024 (1096) | 1065 / 1595 (1330) | yes |
| 223 | 1158 / 1314 (1236) | 1912 / 1261 (1586) | 541 / 555 (548) | 2098 / 1611 (1855) | yes |
| 224 | 1990 / 1368 (1679) | 2138 / 1197 (1668) | 907 / 1329 (1118) | 2235 / 1323 (1779) | yes |
| 225 | 1499 / 1372 (1435) | 2130 / 1545 (1837) | 855 / 1148 (1001) | 1232 / 2146 (1689) | yes |
| 226 | 1738 / 1507 (1622) | 2092 / 1827 (1960) | 542† / 1242 (892) | 662 / 1796 (1229) | yes |
| 227 | 1075 / 1783 (1429) | 1933 / 1673 (1803) | 1388 / 559 (974) | 2179 / 2084 (2132) | yes |
| 228 | 1747 / 1589 (1668) | 2127 / 1687 (1907) | 547† / 537† (542) | 980 / 1228 (1104) | yes |
| 229 | 1181 / 587 (884) | 1067 / 1203 (1135) | 1502 / 766 (1134) | 1381 / 2173 (1777) | yes |
| 230 | 1580 / 1428 (1504) | 946 / 1377 (1161) | 1178 / 542† (860) | 1767 / 710 (1238) | yes |
| 231 | 1549 / 1580 (1565) | 1320 / 1716 (1518) | 1681 / 679 (1180) | 1140 / 1634 (1387) | yes |
| 232 | 1747 / 666 (1206) | 1745 / 1001 (1373) | 541 / 1599 (1070) | 1838 / 1780 (1809) | yes |
| 233 | 1045 / 1714 (1380) | 1560 / 1793 (1676) | 1041 / 883 (962) | 2350 / 516† (1433) | yes |
| 234 | 1383 / 1439 (1411) | 1799 / 1414 (1607) | 550 / 637 (594) | 2029 / 2144 (2087) | yes |
| 235 | 1843 / 1619 (1731) | 632 / 1679 (1155) | 774 / 1695 (1234) | 1818 / 932 (1375) | yes |
| 236 | 1425 / 1270 (1347) | 1740 / 1644 (1692) | 543† / 1212 (877) | 2084 / 545† (1315) | yes |
| 237 | 1495 / 1630 (1563) | 877 / 1599 (1238) | 830 / 816 (823) | 752 / 2592 (1672) | yes |
| 238 | 1396 / 1358 (1377) | 1907 / 763 (1335) | 543† / 712 (627) | 1363 / 2189 (1776) | yes |
| 239 | 1215 / 1324 (1270) | 1916 / 1733 (1824) | 1621 / 1200 (1410) | 1429 / 1424 (1426) | yes |
| 240 | 1953 / 1406 (1680) | 1931 / 1499 (1715) | 1308 / 546† (927) | 1326 / 1715 (1521) | yes |
| 241 | 1479 / 1596 (1538) | 1364 / 1653 (1509) | 1131 / 1185 (1158) | 726 / 2738 (1732) | yes |
| 242 | 1390 / 1290 (1340) | 1104 / 1870 (1487) | 542† / 607 (575) | 1801 / 2142 (1971) | yes |
| 243 | 1084 / 1261 (1172) | 1628 / 1696 (1662) | 1146 / 1145 (1146) | 1992 / 1188 (1590) | yes |
| 244 | 1325 / 1398 (1361) | 1270 / 941 (1105) | 1369 / 764 (1066) | 2340 / 1057 (1699) | yes |
| 245 | 1962 / 1945 (1953) | 1770 / 1834 (1802) | 1271 / 1124 (1198) | 1855 / 1023 (1439) | yes |
| 246 | 1567 / 1510 (1538) | 800 / 1692 (1246) | 538 / 1170 (854) | 2208 / 2206 (2207) | yes |
| 247 | 2073 / 1720 (1897) | 2094 / 2072 (2083) | 728 / 1051 (889) | 1408 / 2826 (2117) | yes |
| 248 | 1876 / 1215 (1545) | 1946 / 1103 (1525) | 1602 / 637 (1119) | 2377 / 546† (1462) | yes |
| 249 | 1484 / 1683 (1584) | 1729 / 1782 (1755) | 669 / 1295 (982) | 1791 / 2466 (2128) | yes |
| 250 | 1845 / 1699 (1772) | 1987 / 2048 (2017) | 748 / 701 (724) | 1915 / 1549 (1732) | yes |

**What memory is used for** (scratch scripts on the held-out runs, not committed). *Mute test:*
each tribe's best hall-of-fame genome at the final generation, benchmarked as it is and with the
weights from its memory inputs set to 0 (the brain then never sees its memory):

| Map | Arena score | Muted | Muted worse | Clones that ever drank (of 25) | Clones alive at the end |
|---|---|---|---|---|---|
| Normal (100 tribes) | 1,947 | 1,169 (0.60×) | 97 / 100 | 18.8 → 13.6 | 7.3 → 2.0 |
| Sparse (100 tribes) | 2,285 | 773 (0.34×) | 100 / 100 | 19.5 → 7.9 | 11.4 → 0.3 |

(Every stored benchmark score was reproduced exactly before muting.) So the evolved champions
depend on their memory; it carries information. *Behaviour while no water is in sight* (sparse
arena, the best genome of each tribe of seeds 201–225): memory-on champions repeat their previous
move 64 % of the time, the same champions muted 92 %, and memory-off champions 91 %. A brain
without memory is a pure function of its sensors: when nothing in sight changes, it does the same
thing again, so it walks straight until it is stuck. Memory gives it state that changes on its own,
so it can turn and search. That is mostly not "remembering where the water was" (plan §2.3), but
closer to the plan's "oscillator input" idea; it helps on the normal map too.

**Recorded, not blocking**

- **The final build reproduces the held-out run:** seeds 201–205 of all four arms (memory-off arms
  through `memory-off.json` / `sparse-water-memory-off.json`) give byte-identical `stats.csv`.
- **Seed 42** (`evolution-learns.test.ts`, now with memory): benchmark 573/895 → 1,801/2,340 at
  generation 100 (2.84×, tribes 3.14× and 2.61×; generation 50: 1,272/2,358); without memory it was
  541/561 → 1,437/1,075 (2.28×). The test passes unchanged.
- **Medium seed 42, 100 generations:** memory on 382,966 ticks in 46.6 s (8,211 ticks/s),
  benchmark 535/556/1,032/624 → 807/1,887/2,511/1,350 (mean 1,639); memory off 372,609 ticks in
  31.6 s (11,784 ticks/s), 508/637/561/628 → 1,028/1,549/669/1,598 (mean 1,211; Sprint 3.4's
  numbers). About 30 % fewer ticks per second, partly from the bigger brain (383 vs 333 weights)
  and partly from more creatures alive per tick; still ~8× the §3.6 Medium target.
- Not done: continuing Sprint 3.4's own champions with memory. Their migration is exact (tests
  above), but the trainer cannot start from a checkpoint until Sprint 5.1, and the from-scratch A/B
  answers the sprint's question.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (307 tests in 40 files),
`pnpm test:browser` (7), `pnpm build`, `pnpm test:e2e` (11) pass locally.

## Retro

**Went well**
- The bar was sized from measured noise (memory off only) and committed before any held-out seed
  and before memory-on had been trained at all, so the result can't have shaped the bar.
- `migrateGenome` + `hashWorldState` turned "a migrated genome behaves exactly as before" into a
  bit-for-bit test over a whole generation, and the unchanged forward-pass digest and Sprint 3.4's
  seed-42 and Medium numbers proved memory-off behaviour unchanged.
- 50 seeds × 4 arms took ~15 minutes, so a large-sample A/B costs less than arguing about luck.

**Surprises / learnings**
- Memory helped far more than expected (1.67× on the sparse map, 1.11× on the normal one) and cut
  hard lock-in, but not mainly by remembering water: it lets a creature change what it does when
  its inputs don't change. Muting it made champions walk straight again.
- On the normal Small map water is in sight from 99 % of the land, so "remember water out of
  sight" barely exists there; a test map for it had to be built.
- The first sparse variant was too hard (memory off reached 1.2× and a third of the tribes locked
  in). A comparison needs a control that can learn; the chosen variant needs 300 generations.
- Tests that hard-code sizes can keep passing for the wrong reason when the default brain grows
  (NaN equals NaN in `toEqual`); size them from the spec.

**Caveats**
- The arms differ in brain size (383 vs 333 weights) as well as memory; no capacity-matched
  control (e.g. 2 extra constant inputs) was run. The mute test and the behaviour check point at
  memory itself, but don't prove that extra weights alone couldn't do part of it.
- Each variant has one arena map, so arena scores reflect that map's layout.
- Champion noise is unchanged (~15 % per single benchmark).

**Notes for later sprints**
- Memory is on by default (`SIM_VERSION` 10): every run trained before is unplayable in the
  viewer (new simVersion and config hash; migration of run files is Sprint 5.1).
- Sprint 4.1/4.2: re-measure lock-in and champion noise with memory on and with combat; score
  tribes by several benchmark generations in multi-seed bars.
- Sprint 4.3 (signals): calls need a commit step (others hear them); reuse this sprint's design
  (noise-sized multi-seed bar, mute test).
- Sprint 6.2 (inspector): show memory values; what memory encodes is only probed here (heading
  persistence), not decoded.
- The A/B, mute and map-water scripts are scratch scripts; if Sprint 4.3 needs them again, commit
  a small cleaned-up version.
