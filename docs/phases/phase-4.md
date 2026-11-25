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
| 4.3 | Signals experiment | Call output + "loudest ally call" sensors behind a switch, tribe-score fitness term on in both arms, A/B on many held-out seeds plus a mute test (recipe from Sprint 3.5) |

## Exit criteria (Phase 4 is done when)

1. Combat, sharing and territory follow plan §2.3/§2.6 and are covered by unit tests; territory %
   of all tribes sums to ≤ 100; `SHARE` ping-pong and kill farming earn nothing extra — Sprint 4.1.
2. Over 10 seeds × 200 generations on Medium: no start slot has the highest tribe score at
   generation 200 in more than 5 seeds; in battle royale ≥ 2 tribes are alive at generation 20 in
   ≥ 7 seeds; champions don't show a degenerate action mix — Sprint 4.2.
3. Signals experiment decided and recorded (kept only if the A/B and the mute test show they help)
   — Sprint 4.3.

## Architecture decisions taken in this phase

(Filled in per sprint.)

## Risks

| Risk | Mitigation |
|------|------------|
| Combat or sharing becomes the only strategy (e.g. everyone attacks, nobody forages) or a fitness exploit | Exploit tests for every term (kills, alliesHelped); caps; watch action mixes; balance in 4.2 |
| Tribes never meet on Small (2 tribes, zones ~28 tiles apart) | Combat is judged on Medium in 4.2; 4.1 checks only that the rules work and learning on Small still holds |
| Balance tuning is open-ended (plan §8) | Trainer `--config` sweeps, multi-seed bars sized from measured noise (Sprint 3.5 recipe), timebox and record what was tried |
| Signals evolve into noise | A/B plus mute test (4.3) |
