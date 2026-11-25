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
