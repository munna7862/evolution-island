# Phase 4 — Tribes & Competition

> Source of truth: `docs/master-plan.md` §4 (Phase 4), §2.3 (actions ATTACK/SHARE, memory &
> signals), §2.5 (fitness, tribe sizes, extinction), §2.6 (territory, combat, cooperation, tribe
> score), §3.3 (determinism), §8 (risks).

## Goal

Reach **Milestone M4 — "Tribal wars"**: tribes that meet, fight, help each other and hold
territory, 4 tribes competing on Medium in a balanced way (no start slot or degenerate strategy
wins by default), and, if the experiment works, tribes that call each other for help.

## Sprints

| Sprint | Title | Outcome |
|--------|-------|---------|
| 4.1 | Combat, sharing, territory | `ATTACK` and `SHARE` act (they were `STAY` since 3.1), kill rewards, territory ownership with decay and territory %, exploit tests for kills and sharing |
| 4.2 | Balance pass | Population caps, fair spawns, hotspots, fitness and tribe-score weights tuned; no dominant start slot, no degenerate action mix; lock-in and champion noise re-measured |
| 4.3 | Signals experiment | Call output + "loudest ally call" sensors behind a switch, A/B on 50 held-out seeds plus a mute test: calls carry information but don't help (sparse 0.87×), signals stay off |

## Exit criteria (Phase 4 is done when)

1. Combat, sharing and territory follow plan §2.3/§2.6 and are covered by unit tests; territory %
   of all tribes sums to ≤ 100; `SHARE` ping-pong and kill farming earn nothing extra — Sprint 4.1.
2. Over 10 seeds × 200 generations on Medium: no start slot has the highest tribe score at
   generation 200 in more than 5 seeds; in battle royale ≥ 2 tribes are alive at generation 20 in
   ≥ 7 seeds; champions don't show a degenerate action mix — Sprint 4.2.
3. Signals experiment decided and recorded (kept only if the A/B and the mute test show they help)
   — Sprint 4.3.

## Architecture decisions taken in this phase

1. **Deaths inside Phase B (Sprint 4.1).** An `ATTACK` that brings health to 0 kills at once
   (`World.killCreature`): the tile frees up for creatures acting later in the same tick, the
   victim's own action and metabolism are skipped. Order comes from the seeded Phase B shuffle,
   targets from health/energy then id, so fights are deterministic.
2. **Two-sided share rule (Sprint 4.1).** Recipient below `shareNeedRatio` *and* giver keeps
   `shareKeepRatio`: energy can't flow back between two allies until the recipient gains energy
   some other way (eating, a kill's loot); one-way help stays valid and is capped by
   `maxAlliesHelped`.
3. **Territory = per-tile owner + last-visit stamp (Sprint 4.1).** Stamped by every living creature
   each tick, faded after `territory.decayTicks`, recounted every `territory.updateInterval`
   ticks, part of the world hash; tribe outcome and stats carried the last recount (the
   generation's average since Sprint 4.2, decision 8).
4. **Pinned tests score tribes by late benchmarks (Sprint 4.1).** The seed-42 regression test uses
   the mean of generations 80/90/100, like the Sprint 3.5 bar, because a single champion's
   benchmark varies ~15 %.
5. **`pnpm analyze` computes balance bars from run folders (Sprint 4.2).** Start-slot winner,
   tribes alive, late scores, hard lock-in and each tribe's best champion's arena action mix
   (`runBenchmarkDetailed`), with every stored benchmark score reproduced first, so a bar is
   measured the same way on development and held-out seeds and later sprints (4.3) can reuse it.
6. **Battle royale has a grace period (Sprint 4.2).** `evolution.battleRoyaleFromGeneration`
   (default 100): eliminations only from then on; before, extinct tribes respawn.
7. **The population budget is always spent (Sprint 4.2).** Places capped tribes can't take go to
   extinct tribes (and tribes that scored nothing), one at a time in index order, up to the cap.
8. **Territory in the tribe outcome is the generation's average (Sprint 4.2).** The world keeps
   the sum of each tribe's recounted % and the number of recounts (both hashed).

## Risks

| Risk | Mitigation |
|------|------------|
| Combat or sharing becomes the only strategy (e.g. everyone attacks, nobody forages) or a fitness exploit | Exploit tests for every term (kills, alliesHelped); caps; watch action mixes; balance in 4.2 |
| Tribes never meet on Small (2 tribes, zones ~28 tiles apart) | Combat is judged on Medium in 4.2; 4.1 checks only that the rules work and learning on Small still holds (4.1: kills are rare on Small and Medium alike) |
| Balance tuning is open-ended (plan §8) | Trainer `--config` sweeps, multi-seed bars sized from measured noise (Sprint 3.5 recipe), timebox and record what was tried |
| Signals evolve into noise | A/B plus mute test (4.3) |
