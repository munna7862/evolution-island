# Sprint 4.3 — Signals experiment

- **Phase:** 4 — Tribes & Competition (`docs/phases/phase-4.md`)
- **Branch:** `sprint-4.3`
- **Personas:** ML / Evolution Engineer (call output, hearing sensors, migration, A/B and mute
  test), Simulation Architect (commit step, determinism, `SIM_VERSION`), Frontend / Rendering Dev
  (ripple rings), SDET (tests, acceptance measurements)

## Goal

Let creatures call (plan §2.3 "Signals"): one call output, heard by allies within `callRadius`
through 3 inputs (loudest call as heard, its offset), behind a config switch and added through
genome migration with zero weights. Find out with an A/B and a mute test whether calls carry
information and help; keep them only if they do, and then re-check the Sprint 4.2 balance bar.
Viewer: a ripple ring when a creature calls.

## Starting point (`main` at `3232dfe`, `SIM_VERSION` 12)

Memory on by default (20 → 12 → 11). Sprint 4.2's balance bar met on Medium seeds 301–340.
Tribes rarely meet before ~200 generations (kills 0.72 per generation per seed late on).

## Design

- **Config** `signals`: `enabled` (default **false**), `callThreshold` 0.5, `callRadius` 16,
  `callCost` 0.1. In the config hash; `--config` can switch it on.
- **Brain spec:** inputs = 18 sensors, M memory, then 3 call inputs (when on); outputs = 9 actions,
  M memory, then 1 call output. Appended at the end, so `migrateGenome` adds them with zero weights.
  With memory and signals: 23 → 12 → 12 = **432 weights** (plan §2.4). The policy needs to know
  whether signals are on (spec sizes alone can't tell 2 memory + signals from other layouts), so
  `createBrainPolicy` takes the brain layout from the config.
- **Call value** = `max(0, softsign(call output))` (0..1), **silent (0) below `callThreshold`**. A
  zero-weight output gives 0, so a migrated genome never calls and behaves exactly as before.
- **Calls are heard on the next tick** (plan §2.3): in Phase A a creature reads the calls committed
  last tick and stores its own as `nextCall`; after Phase B a calling creature pays `callCost`
  energy and counts `callsMade`; after metabolism every creature's `call` becomes its `nextCall`
  (0 if dead). So the order of creatures inside Phase A doesn't matter.
- **Hearing** (3 inputs): over living allies (same tribe, not itself) within `callRadius`
  (Euclidean, `Math.sqrt`), heard strength = call × (1 − distance ÷ callRadius); the loudest wins,
  ties → lowest id. Inputs: heard strength (0..1), dx ÷ callRadius, dy ÷ callRadius; (0, 0, 0) if
  nothing is heard. Enemies can't hear (v1).
- **Hash:** `call` and `nextCall` in the world hash (next to memory); `callsMade` already is.
- **Tribe-score fitness term (plan: "switched on in Sprint 4.3"):** not added. Selection ranks each
  tribe's own members (§2.5), so adding the same `w·tribeScore` to every member changes no ranking
  and no parent choice; it would only shift benchmark scores. Recorded as a plan revision.
- **Viewer:** the creature snapshot carries each creature's call (0..255); creatures calling get a
  ripple ring around them that grows and fades.
- **Tooling:** `pnpm analyze --mute calls` also benchmarks each champion with its call inputs
  zeroed (the plan's mute test).
- `SIM_VERSION` 12 → 13 (tick rule: call commit and cost; brain spec can change).

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file | Before coding |
| 2 | Config, brain layout, call output, hearing sensors, commit step, cost | Unit tests: call 0..1 and silent below threshold; heard next tick only; loudest ally, fading, ties, enemies don't hear, radius; cost and `callsMade` |
| 3 | Migration: memory-only genome → signals brain, zero weights | Same state hash through a whole generation, never calls, same benchmark score |
| 4 | `pnpm analyze --mute calls` | Unit test |
| 5 | Viewer ripple rings (snapshot call byte) | Unit tests for packing and the ring layer; e2e green |
| 6 | Bar proposed to the user before any held-out run; A/B + mute test on held-out seeds; if signals pass, 4.2 balance re-check with signals on | Numbers below |
| 7 | Decision, docs, retro | — |

## Out of scope

- Enemies overhearing calls (open decision, plan §10: "no" for v1).
- A tribe-score fitness term (see above).

## Acceptance bar (fixed before the held-out run)

Chosen by the user on 2026-11-25, before any held-out seed was run and before signals-on was
trained on any seed. Held-out Small seeds **401–450**, each arm run **once**; tribe score = mean of
its last three benchmarks (as in Sprint 3.5); memory on in both arms; config files in
`docs/sprints/sprint-4.3/`:

```
pnpm train --preset small --seeds 401-450 --generations 100 --config docs/sprints/sprint-4.3/signals-off.json --out runs/s43-normal-off
pnpm train --preset small --seeds 401-450 --generations 100 --config docs/sprints/sprint-4.3/signals-on.json --out runs/s43-normal-on
pnpm train --preset small --seeds 401-450 --generations 300 --config docs/sprints/sprint-4.3/sparse-water-signals-off.json --out runs/s43-sparse-off
pnpm train --preset small --seeds 401-450 --generations 300 --config docs/sprints/sprint-4.3/sparse-water-signals-on.json --out runs/s43-sparse-on
pnpm analyze --runs runs/s43-sparse-on --mute calls
```

Signals pass only if all hold:

1. **Normal map, not worse:** signals-on arm score ≥ **0.95 ×** signals-off.
2. **Sparse-water map, better:** signals-on ≥ **1.10 ×** signals-off.
3. **Sparse-water, on most seeds:** signals-on better on **≥ 30 of 50** seeds.
4. **Mute test** (sparse, signals on): the 100 champions with their call inputs zeroed score
   **≤ 0.90 ×** unmuted (mean) and worse for **≥ 60 %** of them — the calls carry information.
5. **If 1–4 pass:** Sprint 4.2's balance bar re-run on Medium seeds 301–340 with signals on (slot
   wins ≤ 16 of 40, battle royale ≥ 2 tribes alive at generation 120 in ≥ 28 of 40, no champion
   above 80 % `STAY`).

Noise (Sprint 3.5, 50 seeds per arm): about ±6 % normal, ±9 % sparse. **If all pass**, signals
become the default (`SIM_VERSION` bump); **if not**, they stay off and the retro says why.


---

## What was done

On branch `sprint-4.3` (from `main` at `3232dfe`).

- **Signals** (commit `4a5bd21`, `SIM_VERSION` 13): config `signals` (off by
  default), call output and 3 hearing inputs appended to the brain, `callValue`
  (`max(0, softsign)`, silent below the threshold), `readCallSensors`, call cost after Phase B,
  commit after metabolism, `brainPolicyForConfig`, `memoryNeuronCount(spec, signals)`; calls in
  the world hash. Tests (`signals.test.ts`, 10): sizes, call value (property), hearing (loudest,
  fading, radius edge, ties, enemies/dead/self), heard on the next tick only, cost and
  `callsMade`, silence on death, **a migrated genome never calls and gives the same state hash
  through a whole generation and the same benchmark score**, signals-on evolution deterministic.
  Pinned `signalsPolicy` golden scenario (3,351 calling creature-ticks) in Node and Chromium.
- **`pnpm analyze --mute memory|calls`**: benchmarks each champion again with those inputs'
  weights zeroed; summary ratio and count worse (tests: exact zeroed range, summary).
- **Viewer ripples:** the creature snapshot carries a call byte (stride 15 → 16); the creature
  layer draws a tribe-tinted ring that grows and fades over 0.9 s around every calling creature,
  under the creatures (tests: packing, ring position/alpha/size, extra frames only while calling).
  With signals off (the default) no ring is ever drawn.

## Acceptance (held-out seeds 401–450, run once)

The bar's commands, at `4072377`. Normal arms 2.6 min each, sparse 7–8 min each.

| Condition | Needed | Result | |
|---|---|---|---|
| 1. Normal map: on / off | ≥ 0.95 | 1,537 / 1,557 = **0.99** (on better on 23 of 50) | pass |
| 2. Sparse-water: on / off | ≥ 1.10 | 1,365 / 1,576 = **0.87** | **fail** |
| 3. Sparse-water: seeds where on is better | ≥ 30 of 50 | **19 of 50** | **fail** |
| 4. Mute test (sparse, on): muted / unmuted, worse | ≤ 0.90, ≥ 60 % | **0.707**, 93 of 100 | pass |
| 5. 4.2 balance re-run with signals on | — | not run (1–4 must pass first) | — |

**Signals fail the bar and stay off** (`signals.enabled` false, as before). The evolved
champions do use their calls (muting them costs 29 %), but tribes that can call end up worse than
tribes that can't on the sparse map, and lock into a single action more often.

Per arm (not blocking): normal off/on ratio 2.81 / 2.73, seeds ≥ 2× 45 / 40, tribes ≥ 1.5× 92 /
88, hard lock-in 0 / 0; sparse off/on ratio 3.01 / 2.53, seeds ≥ 2× 42 / 37, tribes ≥ 1.5× 86 / 72,
**hard lock-in 4 / 11**. Sparse signals-on champions: 33 % `STAY` (max 77 %), 13 % `DRINK`
(memory-only champions in 3.5: 22 % / 21 %).

Every seed's late scores, tribe 0 / tribe 1 (seed score); † = hard lock-in:

| Seed | Normal, off | Normal, on | Sparse, off | Sparse, on | Sparse: on better |
|---|---|---|---|---|---|
| 401 | 1471 / 1696 (1584) | 1585 / 1557 (1571) | 1026 / 576 (801) | 689 / 555† (622) | no |
| 402 | 650 / 1494 (1072) | 1688 / 1554 (1621) | 1838 / 1557 (1698) | 1448 / 730 (1089) | no |
| 403 | 2077 / 1486 (1782) | 2339 / 1410 (1874) | 2485 / 2868 (2676) | 949 / 1964 (1457) | no |
| 404 | 1450 / 1942 (1696) | 1207 / 1522 (1365) | 1015 / 542† (779) | 835 / 1196 (1016) | yes |
| 405 | 2161 / 1695 (1928) | 1014 / 631 (823) | 2419 / 1444 (1931) | 1127 / 1621 (1374) | no |
| 406 | 1777 / 2048 (1912) | 1635 / 1694 (1665) | 2012 / 1692 (1852) | 2004 / 558† (1281) | no |
| 407 | 1126 / 1698 (1412) | 1495 / 1175 (1335) | 1586 / 1713 (1649) | 2215 / 977 (1596) | no |
| 408 | 846 / 1081 (964) | 721 / 1440 (1080) | 1482 / 2186 (1834) | 544† / 1463 (1003) | no |
| 409 | 1383 / 1940 (1662) | 1963 / 2003 (1983) | 1582 / 968 (1275) | 1141 / 873 (1007) | no |
| 410 | 1606 / 1753 (1680) | 1591 / 1121 (1356) | 678 / 1880 (1279) | 1216 / 559† (887) | no |
| 411 | 1390 / 1566 (1478) | 1822 / 1372 (1597) | 764 / 1389 (1077) | 1622 / 1513 (1568) | yes |
| 412 | 1462 / 656 (1059) | 1704 / 1858 (1781) | 646 / 1844 (1245) | 859 / 1025 (942) | no |
| 413 | 1919 / 1426 (1673) | 1178 / 1636 (1407) | 1298 / 1689 (1494) | 2288 / 1427 (1857) | yes |
| 414 | 1503 / 1153 (1328) | 2025 / 1450 (1737) | 2386 / 1721 (2053) | 1650 / 546† (1098) | no |
| 415 | 1549 / 1737 (1643) | 1268 / 1031 (1149) | 1531 / 1214 (1373) | 1476 / 547† (1011) | no |
| 416 | 1330 / 780 (1055) | 1199 / 2083 (1641) | 1511 / 839 (1175) | 533† / 879 (706) | no |
| 417 | 1001 / 1958 (1480) | 1743 / 1720 (1732) | 544† / 1933 (1238) | 619 / 1981 (1300) | yes |
| 418 | 1210 / 1897 (1554) | 1740 / 1687 (1713) | 2454 / 806 (1630) | 1551 / 730 (1141) | no |
| 419 | 1670 / 1663 (1667) | 1464 / 1849 (1656) | 579 / 1825 (1202) | 2050 / 748 (1399) | yes |
| 420 | 798 / 1272 (1035) | 924 / 763 (843) | 2522 / 1160 (1841) | 2140 / 2424 (2282) | yes |
| 421 | 846 / 1701 (1274) | 1239 / 927 (1083) | 2782 / 1019 (1900) | 1559 / 627 (1093) | no |
| 422 | 1790 / 1181 (1486) | 1405 / 1487 (1446) | 1902 / 2405 (2153) | 2513 / 537† (1525) | no |
| 423 | 2230 / 1949 (2089) | 2018 / 1439 (1729) | 1187 / 1666 (1426) | 2516 / 1644 (2080) | yes |
| 424 | 943 / 1354 (1149) | 1494 / 1485 (1489) | 1139 / 2319 (1729) | 1271 / 545† (908) | no |
| 425 | 1717 / 1535 (1626) | 1247 / 1891 (1569) | 1784 / 1706 (1745) | 1675 / 540† (1107) | no |
| 426 | 1677 / 2118 (1897) | 1409 / 1825 (1617) | 1604 / 1930 (1767) | 1257 / 2389 (1823) | yes |
| 427 | 1667 / 1525 (1596) | 1091 / 1298 (1194) | 2307 / 1346 (1826) | 1764 / 656 (1210) | no |
| 428 | 1200 / 2044 (1622) | 804 / 734 (769) | 1509 / 717 (1113) | 2018 / 1080 (1549) | yes |
| 429 | 1199 / 1672 (1436) | 1992 / 863 (1428) | 2712 / 1460 (2086) | 2499 / 1015 (1757) | no |
| 430 | 1349 / 1880 (1615) | 1354 / 2244 (1799) | 2149 / 2358 (2254) | 1713 / 549† (1131) | no |
| 431 | 1829 / 1271 (1550) | 1409 / 1704 (1557) | 1098 / 2227 (1662) | 609 / 2005 (1307) | no |
| 432 | 1439 / 1483 (1461) | 2023 / 981 (1502) | 544† / 1737 (1140) | 740 / 1828 (1284) | yes |
| 433 | 1435 / 1980 (1708) | 1946 / 2149 (2048) | 1704 / 1539 (1621) | 1106 / 1500 (1303) | no |
| 434 | 865 / 1785 (1325) | 1676 / 1037 (1357) | 1676 / 2264 (1970) | 2337 / 1735 (2036) | yes |
| 435 | 1470 / 1961 (1716) | 1965 / 1863 (1914) | 888 / 2062 (1475) | 1276 / 1705 (1491) | yes |
| 436 | 1598 / 2024 (1811) | 1621 / 1619 (1620) | 1201 / 547† (874) | 1500 / 2101 (1801) | yes |
| 437 | 958 / 630 (794) | 2181 / 2039 (2110) | 2435 / 2075 (2255) | 1889 / 549 (1219) | no |
| 438 | 1332 / 1933 (1633) | 1649 / 1321 (1485) | 709 / 987 (848) | 825 / 1915 (1370) | yes |
| 439 | 988 / 1654 (1321) | 1603 / 2320 (1962) | 1937 / 1142 (1540) | 1685 / 667 (1176) | no |
| 440 | 2211 / 1581 (1896) | 1182 / 713 (948) | 1655 / 1685 (1670) | 1539 / 1278 (1408) | no |
| 441 | 2084 / 1697 (1891) | 1396 / 1444 (1420) | 1878 / 1053 (1466) | 1951 / 1320 (1636) | yes |
| 442 | 1329 / 1359 (1344) | 1895 / 1945 (1920) | 1841 / 1431 (1636) | 1982 / 818 (1400) | no |
| 443 | 1561 / 1976 (1769) | 2075 / 1625 (1850) | 1871 / 1620 (1746) | 1646 / 594 (1120) | no |
| 444 | 1626 / 1666 (1646) | 1756 / 1812 (1784) | 2023 / 966 (1494) | 1181 / 675 (928) | no |
| 445 | 1937 / 1858 (1897) | 2022 / 1314 (1668) | 1592 / 1442 (1517) | 2082 / 1239 (1660) | yes |
| 446 | 1534 / 2154 (1844) | 1665 / 1685 (1675) | 1361 / 1543 (1452) | 1534 / 1784 (1659) | yes |
| 447 | 1416 / 1724 (1570) | 575 / 1407 (991) | 2120 / 1931 (2025) | 1728 / 2606 (2167) | yes |
| 448 | 1748 / 1529 (1639) | 1831 / 1549 (1690) | 1778 / 1818 (1798) | 1523 / 1641 (1582) | no |
| 449 | 1554 / 2134 (1844) | 1791 / 1576 (1684) | 1472 / 694 (1083) | 2675 / 622 (1649) | yes |
| 450 | 1797 / 1655 (1726) | 1712 / 1557 (1635) | 2351 / 542 (1446) | 849 / 1595 (1222) | no |

## Retro

**Went well**
- Bar fixed before any signals-on training; the four arms took 21 minutes; the mute test came for
  free from `pnpm analyze`.
- Migration and the commit step made "calls can't change a migrated brain" a bit-for-bit test.

**Surprises / learnings**
- **Calls carry information but don't help.** Muting the champions' call inputs costs 29 % (93 of
  100 worse), so evolution builds behaviour on them; still the whole population does 13 % worse on
  the sparse map, with almost three times as many locked-in tribes. Likely causes, untested here:
  calling costs 0.1 energy a tick, half the base drain, so a creature that calls all the time
  starves much sooner; 4 more inputs and 13 more weights to tune in 300 generations; in a one-tribe
  arena "follow the loudest call" leads clones to each other rather than to water.
- The plan's tribe-score fitness term can't do what §2.5 hoped (per-tribe ranking ignores a
  tribe-wide constant); dropped, recorded in the plan.

**If signals are tried again** (not in this sprint: the held-out seeds are spent): sweep
`callCost` (e.g. 0, 0.02) and `callThreshold` on development seeds first; give calls a reason
to exist (combat on Medium, where a call could bring allies to a fight) and judge them there.

**Notes for Phase 5**
- `SIM_VERSION` 13; the snapshot stride is 16 bytes. Signals stay available behind the switch;
  the viewer shows ripples when a run is trained with them on.
