# Evolution Island — rules for Claude Code
- Read docs/master-plan.md and the current sprint file before coding.
- Work one sprint at a time; don't start the next sprint without asking.
- sim-core must stay pure and deterministic: no Math.random, no Date, no performance.now, no DOM.
- sim-core math: only + - * /, Math.floor/ceil/round/abs/min/max/sqrt/imul/fround.
  No Math.exp/tanh/sin/cos/pow/log (results differ between JS engines and break replays).
- All randomness comes from the named RNG streams in rng.ts; never share one stream between systems.
- Break every tie by id; use stable sorts.
- All balance numbers go in config.ts — never hard-code them.
- Every new rule/action needs a unit test. Every fitness term needs an exploit test. Keep `pnpm test` green.
- Changing the sensor list, brain spec or tick rules bumps simVersion.
- New brain inputs/outputs go behind a config switch and are added through genome migration (zero weights).
- Prefer small, readable functions; TypeScript strict; no `any`.
- At sprint end: update docs/sprints/<sprint>.md with what was done + retro notes.
- When a design decision changes, update docs/master-plan.md too (tick the open decision, add a revision note).
