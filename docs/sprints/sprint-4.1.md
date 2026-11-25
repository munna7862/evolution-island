# Sprint 4.1 — Combat, sharing, territory

- **Phase:** 4 — Tribes & Competition (`docs/phases/phase-4.md`)
- **Branch:** `sprint-4.1`
- **Personas:** Game Designer (attack/share/territory rules and numbers), Simulation Architect
  (tick order, deaths inside Phase B, determinism, `SIM_VERSION`), SDET (rule tests, property and
  exploit tests, golden hashes), ML / Evolution Engineer (does learning on Small still hold)

## Goal

Make `ATTACK` and `SHARE` do what plan §2.3 says (they act as `STAY` since Sprint 3.1), reward
kills, and give tribes territory that fades without sustained presence (plan §2.6), so Sprint 4.2
has something to balance. Plan §4: unit tests for combat and sharing; territory % sums to ≤ 100;
`SHARE` ping-pong between two allies earns no extra fitness.

## Starting point (`main` at `ce9b130`, `SIM_VERSION` 10)

Sprint 3.5 merged: 2 memory neurons on by default (brain 20 → 12 → 11). The fitness terms
`kills` (weight 10) and `alliesHelped` (weight 5, capped at 10 per generation) and the tribe-score
term `territory` (weight 0) exist but are always 0. `tribeOutcome` returns `territoryPct: 0`.

## Design

**`ATTACK`** (plan §2.3). Targets the adjacent enemy (8-neighbourhood, alive, other tribe) with the
lowest health, ties → lowest id. Deals `creature.attackDamage` (20: five hits kill a full-health
creature, six if it is hit once a tick and heals 0.25 a tick in between) and costs the attacker `creature.attackEnergyCost` (0.5, already in config).
No adjacent enemy → `STAY` (no cost). If the victim's health reaches 0 it dies at once, inside
Phase B: it leaves its tile (another creature may step there later in the same tick), its own
action is skipped if it had not acted yet, and it gets no metabolism or `ticksAlive` for this
tick. The killing blow gets the kill (`stats.kills`) and `creature.killEnergyFraction` (0.5) of the
victim's remaining energy (capped at max energy; this is not `foodEaten`). Damage from earlier hits
counts toward the kill of whoever lands the last one.

**`SHARE`** (plan §2.3). Targets the adjacent ally (8-neighbourhood, alive, same tribe) with the
lowest energy, ties → lowest id. Valid only if that ally is **below** `creature.shareNeedRatio`
(0.5) of max energy **and** the giver keeps **at least** `creature.shareKeepRatio` (0.5) of max
energy after giving. The giver loses `creature.shareAmount` (10), the recipient gains
`shareAmount × shareEfficiency` (0.8 → 8; capped at max energy). A valid share adds 1 to the
giver's `stats.alliesHelped` (fitness caps it at `maxAlliesHelped` per generation, unchanged).
Invalid → `STAY`.

*Why the giver rule (an addition to the plan):* with only "recipient below 50 %", two allies that
are both below 50 % can pass energy back and forth; each pass loses 20 % but earns the giver +5
fitness, and when thirst, not hunger, ends their lives the lost energy costs nothing. Requiring the
giver to keep ≥ 50 % makes a valid share go from a creature at ≥ 60 % to one below 50 %; the
recipient ends below 58 % and the giver at ≥ 50 %, so the recipient can only give back after it
gains energy some other way (eating, or a kill's loot). Repeated one-way help from a well-fed creature to a hungry one stays
valid (and capped).

**Territory** (plan §2.6, §3.4). Per tile: an owner tribe (−1 = none) and the tick it was last
stamped. After metabolism each tick, every living creature stamps its tile with its tribe (one
creature per tile, so the order does not matter; a creature moves at most one tile per tick, so
a living creature's whole path is stamped; one that dies during a tick does not stamp the tile it
died on). Every `territory.updateInterval` ticks (10) the world drops
ownership older than `territory.decayTicks` (300 ticks, a tenth of a Small generation) and
recounts each tribe's territory % = owned tiles ÷ walkable tiles × 100. A tile has at most one
owner, so all tribes together hold ≤ 100 %. `startGeneration` clears territory. `tribeOutcome`
takes the tribe's territory %, so `GenerationStats.territoryPct` and `stats.csv` report it; the
tribe-score weight stays **0** (tuning it is Sprint 4.2).

**Determinism.** Deaths inside Phase B follow the seeded shuffle order; targets are chosen by
health/energy then id; territory arrays and percentages are in the world hash (and
`hashWorldState`). `SIM_VERSION` 10 → 11 (tick rules change); golden hashes re-recorded.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | This file and `docs/phases/phase-4.md` | Written before coding |
| 2 | Config: `attackDamage`, `killEnergyFraction`, `shareAmount`, `shareEfficiency`, `shareNeedRatio`, `shareKeepRatio`; `territory.decayTicks`, `territory.updateInterval`; all in the config hash and `--config` | Override tests for the new whole-number fields |
| 3 | `ATTACK`: target choice, damage, energy cost, death inside Phase B, kill credit and energy | Unit tests per rule, incl. ties, dead targets, allies never hit, victim skipped later in the tick |
| 4 | `SHARE`: target choice, need/keep rules, efficiency, `alliesHelped` | Unit tests per rule; ping-pong exploit tests (incl. a property test over random energies) |
| 5 | Territory stamps, decay, % per tribe, reset at generation start, `tribeOutcome` + stats | Unit tests: decay ("no trail of footprints"), reset; property test: sum ≤ 100 % on random worlds |
| 6 | Kill exploit tests: one kill per death, only the killing blow, no credit for deaths by thirst or for allies | Tests green |
| 7 | `SIM_VERSION` 11, golden hashes, old "ATTACK/SHARE act as STAY" tests replaced | `pnpm test`, `test:browser`, `test:e2e` green |
| 8 | Learning still holds: seed-42 regression test; Small seeds 1–20 before/after (100 generations); how often creatures attack/share/kill on Small and Medium | Numbers recorded below |
| 9 | Docs: this file (results, retro), `phase-4.md`, plan revision note | — |

## Definition of done

- Rules and tests above; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`,
  `pnpm build`, `pnpm test:e2e` pass locally and in CI.
- Every new fitness-relevant behaviour (kills, alliesHelped, territory) has an exploit test.
- The seed-42 "it learns" test still passes, or the retro explains the change.

## Out of scope

- Tuning combat/share numbers and tribe-score weights, balance on Medium — Sprint 4.2.
- Viewer effects for attacks, shares or territory (the dashboard and inspector come in Phase 6).
- Signals — Sprint 4.3.

---

## What was done

On branch `sprint-4.1` (from `main` at `ce9b130`).

**Rules** (commit `0d9700e`, `SIM_VERSION` 11). `actions.ts`: `ATTACK` and `SHARE` as designed
above, through two new `ActionWorldContext` hooks, `creatureAt` and `killCreature` (a death inside
Phase B frees the tile at once and skips the victim's action and metabolism). `world.ts`: per-tile
`territoryOwner` / `territoryStamp`, stamped at spawn and after metabolism each tick, recounted
every `territory.updateInterval` generation ticks (`updateTerritory`, `territoryPercent`), cleared
by `startGeneration`. `tribeOutcome(members, territoryPct)` and `EvolutionRun` report territory %
in `GenerationStats` / `stats.csv`. The world hash and `hashWorldState` cover territory. New config
(`config.ts`, config hash, `--config` whole-number fields): `attackDamage` 20,
`killEnergyFraction` 0.5, `shareAmount` 10, `shareEfficiency` 0.8, `shareNeedRatio` 0.5,
`shareKeepRatio` 0.5, `territory.decayTicks` 300, `territory.updateInterval` 10. The tribe-score
territory weight stays 0.

**Tests** (334 in 42 files, +27):
- `combat.test.ts` (16): `ATTACK` hits diagonals, costs energy, never hits allies or creatures out
  of reach, picks lowest health then lowest id, kills at 0 health (tile freed, `livingCount`, kill
  and loot, capped at max energy, dead creatures no target), a kill inside a tick (the victim does
  not act and gets no `ticksAlive`), the killing blow alone gets the kill. Kill exploits: a victim
  that dies of thirst after a hit credits nothing; in random 3-tribe brawls (property test) every
  death credits exactly one kill. `SHARE`: amount and efficiency, lowest-energy ally then lowest id,
  never an enemy, the need and keep thresholds exactly, recipient capped. Ping-pong exploits: two
  hungry allies that always `SHARE` end exactly like two that `STAY`; for any starting energies
  (property test) no ally both gives and receives and nobody gives more often than its surplus
  allows; real one-way help is the only extra fitness, bounded by the cap.
- `territory.test.ts` (9): owner and % (owned ÷ walkable), decay ("a walker owns its last
  `decayTicks` tiles, not its trail"), standing renews ownership, recount only every interval,
  cleared at generation start, all tribes ≤ 100 % and each within 0..100 on random worlds with
  random decay/interval (property test), in the state hash, in `tribeOutcome`, the tribe score and
  the recorded generation stats.
- Golden hashes re-recorded (map hash and the sensor + forward-pass digest unchanged) plus a new
  pinned **brawl** scenario (7×7 block, 3 tribes, random policy: 23 kills, 8 valid shares by tick
  60), checked in Node and Chromium.
- Old "ATTACK/SHARE act as STAY" tests renamed to what they still prove (nobody to hit or help).

**Seed-42 regression test** (`evolution-learns.test.ts`). With sharing on, seed 42 evolves
differently: benchmark 573/895 → 2,184/1,172 at generation 100. The mean doubles (2.29×) but tribe
1's single generation-100 champion is only 1.31× its generation 1, after 2.31× and 2.17× at
generations 80 and 90: the champion noise Sprint 3.5 measured (~15 % per benchmark). User's
decision: score each tribe by the mean of its generation 80/90/100 benchmarks, same thresholds.
Seed 42 then gives 3.60× and 1.93× (mean 2.58×; generation 50: 1.96×).

## Measurements

**Learning on Small is unchanged** (held-out seeds 201–250, 100 generations, same metric as the
Sprint 3.5 bar; "before" = Sprint 3.5's memory-on arm, the same build without combat, sharing and
territory):

| | Before (3.5, memory on) | After (4.1) |
|---|---|---|
| Mean tribe score (generations 80–100) | 1,596 | 1,569 (0.98×; after better on 22 of 50 seeds) |
| Mean ratio generation 100 / generation 1 | 2.81 | 2.82 |
| Seeds ≥ 2× generation 1 and ≥ 2× STAY-only | 46 / 50 | 46 / 50 |
| Tribes ≥ 1.5× generation 1 | 94 / 100 | 91 / 100 |
| Hard lock-in | 0 | 0 |

The difference is well inside the ±6 % noise between equal 50-seed arms (Sprint 3.5).

**Combat is rare so far.** On Small the two tribes' zones are ~28 tiles apart: 163 kills in total
over 50 seeds × 100 generations (≈ 0.03 per generation per seed). On Medium (seeds 101–103, 100
generations, 4 tribes of ~50): 0.0–0.1 kills per generation in generations 1–10 and 0.0–0.4 in
91–100. Benchmarks (mean of the 4 tribes) rose 793 → 1,869, 695 → 1,556 and 555 → 1,323 (ratios
2.36 / 2.24 / 2.38).

**Territory at generation end is tiny:** 0.3–1.4 % for all four tribes together on Medium at
generation 100, and about 0.5 % per tribe on Small (mean over the generation ends where it is not 0). Few creatures are alive when a generation ends, and a
tile stays owned 300 ticks after its last visit. As a tribe-score term (weight 0 now) it would
reward little; Sprint 4.2 may prefer territory averaged over the generation.

**Speed.** Same Medium scenario (200 creatures kept alive, 1,500 ticks), `main` and this branch
built side by side and run alternately: medians 1,363 vs 1,144 ticks/s, then 1,075 vs 1,170 (the
machine was under varying load): no consistent difference. Trainer, Medium seeds 101–103 in
parallel: 6,100–6,300 ticks/s per seed (§3.6 target > 1,000).

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (334 tests in 42 files),
`pnpm test:browser` (8), `pnpm build`, `pnpm test:e2e` (11) pass locally.

## Retro

**Went well**
- Writing the share rule down before coding showed the plan's "recipient below 50 %" rule alone
  still lets two hungry allies farm fitness; the keep rule closes it, and the property test checks
  it for any starting energies.
- Comparing 50 seeds before/after (the Sprint 3.5 runs were still there) settled "did this slow
  learning?" in two minutes, so the seed-42 failure could be read as champion noise, not a
  regression.
- A pinned brawl scenario puts combat, sharing and territory under the cross-engine golden test;
  the existing scenarios never had a kill.

**Surprises / learnings**
- Tribes almost never meet: combat exists but barely happens on Small, and rarely on Medium after
  100 generations. Whether fighting pays is a Sprint 4.2 question (hotspots, generation length,
  zone distance), not something these rules decide.
- Territory measured at generation end mostly measures who is still alive; the plan's
  "territory %" needs a time window to mean "held ground".
- A pinned single-seed test tied to one benchmark generation broke on noise once the rules
  changed; late scores (three benchmarks) are the robust version.

**Notes for Sprint 4.2**
- Tune `attackDamage`, `killEnergyFraction`, share numbers and the territory weight there;
  consider territory averaged over the generation for the tribe score.
- Measure action mixes on Medium (attacks, shares) next to the balance criteria; kills are rare
  now.
- Use multi-seed bars sized from measured noise (Sprint 3.5 recipe) for the balance criteria.

## Review (2026-11-25)

A fresh session reviewed PR #14 against `CLAUDE.md`, plan §2.3, §2.5, §2.6, §3.3–3.4, §4 Sprint
4.1 and the revision notes, `phase-4.md` and this file, with `git diff ce9b130...sprint-4.1`.

**Checked, no change needed**
- **Rules match the design.** `ATTACK`: 8-neighbourhood, living creatures of other tribes, lowest
  health then lowest id; 20 damage for 0.5 energy; nobody adjacent → `STAY` at no cost. At 0 health
  `World.killCreature` sets health 0 and `alive` false, frees the tile, lowers `livingCount` and
  marks the grid dirty; the Phase B loop and metabolism skip dead creatures (no action, no
  `ticksAlive`, no age). The killing blow alone gets the kill and half the victim's remaining
  energy, capped at max and not counted as `foodEaten`. `SHARE`: lowest-energy ally then lowest id;
  recipient strictly below 50, giver ≥ 50 after giving; −10 / +8, capped; `alliesHelped` +1; the
  fitness cap (10) is unchanged.
- **No flow back, by arithmetic.** A recipient ends below need·max + amount·efficiency = 58 and a
  giver needs keep·max + amount = 60, and more shares can't lift a recipient past 58, so without
  food or a kill's loot energy never goes back. The guarantee needs
  `shareNeedRatio·maxEnergy + shareAmount·shareEfficiency ≤ shareKeepRatio·maxEnergy + shareAmount`;
  Sprint 4.2 tuning must keep it (efficiency 1.0 with keep 0.4 would break it; the property test
  uses the defaults and would fail).
- **Determinism.** The new sim-core code uses only `Math.max/min/floor`; targets are picked by
  health/energy then id; deaths follow the seeded shuffle and draw no random numbers; stamping is
  one creature per tile, so its order doesn't matter. Territory owner, stamp and the % tally are in
  `writeWorldState` (so in `hashWorld` and `hashWorldState`). All new numbers are in `config.ts` and
  `hashConfig`; `territory.decayTicks` / `updateInterval` are hashed as 32-bit integers and listed
  as whole numbers in `config-override.ts`, which still lists exactly the fields `hashConfig`
  writes that way.
- **Territory.** Stamped at spawn and after metabolism; decay compares `tickCount` (not reset at a
  generation start; owners and stamps are). The recount runs when `generationTick % interval` is 0,
  i.e. after a generation's 1st, 11th, 21st … tick, so `tribeOutcome` gets the last recount (up to
  9 ticks old) and it includes tiles of creatures that died within the last 300 ticks. The sum
  ≤ 100 % holds by construction; in floating point it can exceed 100 by one ulp (7 tribes on one
  of 7 tiles each: 100.00000000000001), so the property test's 1e-9 tolerance is right. Its random
  worlds reach up to ~47 %; the pinned brawl reaches full cover (99.99999999999999 %).
- **Seed-42 test** implemented as the user decided: each tribe's mean of its generation 80/90/100
  benchmarks against the unchanged thresholds. Reproduced: generation 1 573.2 / 894.7, 50:
  1,176 / 1,703 (1.96×), 80: 1,719 / 2,064, 90: 2,287 / 1,944, 100: 2,184 / 1,172; late scores
  3.60× / 1.93× (mean 2.58×), as stated.
- **Measurements** recomputed from `runs/s41-normal` and `runs/s35-normal-on` (the 4.1 runs'
  `run.json`: `simVersion` 11, config `d7ef48102997a8a2` = this build's default). Small: tribe score
  1,596 → 1,569 (0.983×), after better on 22 of 50 seeds, mean per-seed ratio 2.81 → 2.82, seeds at 2×
  generation 1 and 2× STAY-only (515) 46 → 46 of 50, tribes ≥ 1.5× 94 → 91, 163 kills, territory
  0.48 % where not 0. Medium (`runs/s41-medium`): kills per generation 0.0 / 0.1 / 0.1 in
  generations 1–10 and 0.4 / 0.0 / 0.0 in 91–100, territory at generation 100 1.41 / 0.58 / 0.34 %
  for all tribes together. The Medium benchmarks were truncated, not rounded, and seed 103's ratio
  was 2.384, not 2.39: corrected above. Speed was not re-measured.
- **Brawl scenario** reproduces its comment: 37 creatures, by tick 60 23 kills, 8 valid shares,
  23 dead, territory 42.9 / 40.8 / 16.3 %. `SIM_VERSION` comment, golden-hash procedure, the
  renamed "nobody to hit or help" tests and the test counts in "What was done" are right.

**Found and fixed** (tests: 334 → 337 in 42 files; `combat.test.ts` 16 → 18, `territory.test.ts`
9 → 10)
1. **Unhashed state survived a generation start.** `World.tribeSlots` (the length of the territory
   tally) was not reset by `startGeneration` and is not hashed. A world that once had a tribe that
   is gone now (battle royale: an eliminated tribe with the highest id, or a checkpoint replayed in a
   fresh world without it) hashed the same as a fresh world right after the reset, then differently
   after the first recount (tally length 2 vs 1). The creatures behaved the same, but "same hash =
   same world" broke. Now reset at generation start, so it is derived from the hashed creatures.
   New test "keeps no trace of earlier tribes after a generation start" failed before the fix. No
   golden scenario has an eliminated tribe, so the golden hashes are unchanged.
2. **Tie-break tests passed for the wrong reason.** In both "ties → lowest id" tests (`ATTACK`,
   `SHARE`) the lower-id creature was also the first tile the 8-neighbourhood search visits: with
   the id tie-break deleted from `lowestNeighbour`, all 16 combat tests still passed. Both tests
   now put the tied pair on the first and last tile searched, both ways round; deleting the
   tie-break, or letting the last tie found win, now fails both.
3. **The ping-pong test couldn't see a same-tick swap.** "No ally both gives and receives" counted
   a received share only when energy rose over a tick, but when both give in the same tick (the
   ping-pong pattern) each ends 2.2 lower and nothing was counted. Without the keep rule the test
   still failed, through its surplus check. In a pair every valid share goes to the partner, so
   shares received are now the partner's `alliesHelped`, exactly.
4. **"…and the `alliesHelped` cap bounds it" never reached the cap** (the giver gave 4 times, cap
   10). The cap is now its own test: a giver on rich grass eats and shares among 8 starving allies
   (> 20 valid shares in 100 ticks), and its fitness gains exactly 10 × 5.
5. **No test for "another creature may step there later in the same tick"**: added (the tile is
   blocked before the killing blow and free right after it).
6. **Docs.** "A full-health creature dies from the fifth hit" (`config.ts`, this file): a well-fed
   victim hit once a tick heals 0.25 in between and dies from the sixth hit (checked); now says so.
   "Energy can only flow back after one of them eats or starves for a while": starving never lets
   it flow back, a kill's loot does; fixed here, in `phase-4.md` and the plan revision note. "Every
   visited tile is stamped": a creature that dies during a tick doesn't stamp the tile it died on;
   reworded. Plan §2.5 now names the giver rule for `alliesHelped`; the §3.4 pseudo-code stamped
   territory "live" in Phase B and recounted on `tickCount % territoryInterval`, and now shows what
   was built (stamps after metabolism, `generationTick % territory.updateInterval`).

**Noted for Sprint 4.2** (no change here): keep the share inequality above when tuning; if
territory gets a tribe-score weight, consider recounting at generation end (or averaging over the
generation, as the retro says), since the outcome now uses a recount up to 9 ticks old that still
counts the footprints of the dead.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (337 tests in 42 files),
`pnpm test:browser` (8), `pnpm build`, `pnpm test:e2e` (11) pass locally. `SIM_VERSION` stays 11
(unmerged); golden hashes unchanged.
