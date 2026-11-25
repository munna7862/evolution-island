# Sprint 6.2 — Creature inspector & follow-cam

- **Phase:** 6 — Spectator Experience (`docs/phases/phase-6.md`)
- **Branch:** `sprint-6.2`
- **Personas:** Frontend / Rendering Dev, ML / Evolution Engineer (what the brain shows), SDET

## Goal

Plan §4 Sprint 6.2: click a creature → stats, sensors, current action, memory and call values
(if enabled), live brain activation view (queried from the worker on demand); follow-cam on a
selected creature or a tribe's champion. ✅ Playwright: clicking a creature opens the inspector
with live values; follow-cam keeps the creature on screen.

## Design

- **`inspectCreature`** (shared, pure, read-only on the world): stats, world fitness so far, chosen
  and resolved action, kills / helped / food / water, the brain's inputs **exactly as the policy
  builds them** (18 named sensors, then memory, then call inputs when on), memory and call, and the
  forward pass on those inputs (hidden activations, named outputs). Creatures without a brain
  (random mode) show sensors only. **`currentChampion`**: a tribe's living creature with the best
  world fitness so far (ties → lowest id).
- **Worker:** `inspect` message with a target (a creature id, a tribe's champion, or none); the
  inspection then rides on every snapshot, so the panel is live at any speed.
- **Map view:** a press released within 4 px is a click → the tile → the creature on it (or
  closes the inspector); **follow-cam** (`setFollow`) centres the camera on the creature's drawn
  (interpolated) position each frame.
- **Panel** bottom left: title (tribe, id, champion/dead), stats grid, Brain (hidden and output
  bars) and Sensors sections, Follow and Close. Clicking a dashboard row inspects that tribe's
  champion. Debug hook: `inspection`, `following`, `inspect()`, `creatureTiles()`.
- No simulation change (`SIM_VERSION` 13).

## What was done

As designed. **Tests:** unit — `inspect.test.ts` (3: inputs/hidden/outputs equal a direct forward
pass and the world hash is unchanged; sensors only without a brain; champion choice incl. ties
and the dead), a worker test (inspection by id follows ticks, champion target, closing); e2e —
click a creature on the canvas → inspector with its id and 18 inputs; its age follows the ticks;
with Follow on, after 28 more ticks the camera is centred on it; clicking an empty tile closes the
inspector.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`,
`pnpm test:e2e` (15) pass locally.

## Retro

**Went well**
- Sending the inspection with every snapshot (instead of request/response per frame) made the
  panel live at every speed with one message type.
- Building the inputs with the same functions as the policy means the inspector can't drift from
  what the brain really sees (tested against a direct forward pass).

**Surprises / learnings**
- Between ticks the inspected brain shows what it *would* decide on the current state; food
  regrows at the start of the next tick, so its next choice can differ slightly. The panel shows
  "Chose" (last tick) next to the live activations.

**Notes for Sprint 6.3**
- Lineage needs parent ids: genomes don't carry them yet, so the family tree has to record
  parents at breeding time.

## Reviews (2026-11-25)

Two passes in the implementing session (the app does not let it start sessions from an automated
turn). **Review 1 — behaviour.** Found: an inspection by id silently switched to another creature
at a generation end (ids restart at 0 each generation). **Fixed:** the worker ends an inspection
by id with its generation (the panel says so); a champion target carries on with the new
generation's champion. New worker test. Checked: a follow stops when the creature dies; clicks
need < 4 px of movement, so drags still pan; dashboard rows are only clickable while it shows.
**Review 2 — docs/tests.** Unit tests 400 in 51 files (+6), e2e 15 (+1); texts agree. Nothing else
to fix.

**Local flakiness (not a code issue).** With another program holding the CPU at ~90 %, two
sim-core tests this sprint did not touch (`resume` "continues bit for bit…", `world` invariants
property test, ~5 s each when idle) hit Vitest's 5 s default, and one e2e run timed out; CI passed
the same commit, and a re-run passed all 15 e2e tests. The two tests now have a 30 s timeout.
