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
lowest health, ties → lowest id. Deals `creature.attackDamage` (20: a full-health creature dies
from the fifth hit) and costs the attacker `creature.attackEnergyCost` (0.5, already in config).
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
recipient ends below 58 % and the giver at ≥ 50 %, so energy can only flow back after one of them
eats or starves for a while. Repeated one-way help from a well-fed creature to a hungry one stays
valid (and capped).

**Territory** (plan §2.6, §3.4). Per tile: an owner tribe (−1 = none) and the tick it was last
stamped. After metabolism each tick, every living creature stamps its tile with its tribe (one
creature per tile, so the order does not matter; a creature moves at most one tile per tick, so
every visited tile is stamped). Every `territory.updateInterval` ticks (10) the world drops
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
91–100. Benchmarks rose 793 → 1,868, 694 → 1,556 and 555 → 1,323 (mean ratios 2.36 / 2.24 / 2.39).

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
