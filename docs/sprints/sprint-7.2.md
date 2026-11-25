# Sprint 7.2 — Climate & disasters

- **Phase:** 7 — Scale & World Events (`docs/phases/phase-7.md`)
- **Branch:** `sprint-7.2`
- **Personas:** Simulation Engineer, Frontend / Rendering Dev, SDET

## Goal

Plan §4 Sprint 7.2:
- Winter phase (low regrowth), droughts, floods (recompute the water field) and migrating food zones.
- A spectator-triggered events button: drop a disaster and watch the tribes react. Events are recorded in the replay at their tick.
- ✅ A unit test per event, and a replay containing spectator events reproduces the same state hash.

## Design

**Climate** (`sim-core/src/climate.ts`, `config.climate`, on by default) is owned by each `World`. Natural climate events:

| Event | What it does |
|---|---|
| Winter | The last `winterFraction` (0.25) of every `yearLength` (1,000) ticks. Food regrows at `winterRegrowthMultiplier` (0.25×). |
| Drought | Shallow water within `droughtRadius` (10) dries to sand for `droughtDuration` (600) ticks. |
| Flood | Sand, grass and forest within `floodRadius` (8) turn to shallow water for `floodDuration` (400) ticks. Their food is lost, the tiles stay walkable, and creatures can drink there. |
| Food zone | Food regrows `foodZoneRegrowthMultiplier` (3×) as fast within `foodZoneRadius` (8). The zone starts on a random land tile and moves `foodZoneStep` (4) tiles in one of 8 directions every `foodZoneMoveInterval` (200) ticks. |

- Every `disasterCheckInterval` (500) ticks, a drought (on a random shallow-water tile) and a flood (on a random land tile) may each start, with a 15% chance each. All draws come from a new `climate` RNG stream.
- **Terrain changes:**
  - A drought or flood recomputes every tile in its area: the biome as generated, then the events in progress applied oldest first.
  - A tile that changed gets its biome's food maximum, keeping the generated one when it returns to its own biome. Its food is capped at the new maximum, and the tile goes on the regrowth list.
  - Then the water field is recomputed.
- **The world keeps its own copies** of biomes, food maximums and the water field, because maps can be shared between worlds (for example the benchmark arena's). Events are undone at each generation start, so every generation begins on the map as generated.
- **Spectator events** go through `world.applyWorldEvent({ kind, x, y })` between ticks: a drought, flood or food zone at a tile, or a winter lasting `winterEventDuration` (300) ticks. They work even with natural climate off. A place off the map is refused and changes nothing.
- **Replays:**
  - `ReplayEvent` = a world event plus `tick`, the number of ticks played before it.
  - `recordReplay` and `playReplay` apply events between ticks with `applyDueEvents`.
  - `parseReplay` checks the kind, integer coordinates, the tick range and the order.
- **Worker:**
  - A `worldEvent` message applies an event now and records it for "Export replay". Before the event, the worker records a hash at that tick, so an export that ends there ends on the world before the event.
  - While a replay plays, the file's events drive it and spectator events are ignored.
  - Snapshots carry a `climate` status.
- **Viewer:**
  - Drought, Flood, Winter and Food zone buttons. Drought, Flood and Food zone wait for a map click; Escape cancels. They are disabled during a replay.
  - The map draws discs for droughts and floods, a ring for the food zone, and a frost wash in winter.
  - The HUD shows a climate line such as "Winter · 1 flood".
- **Benchmark arena:** no natural climate (`arenaConfig`). It is the fixed yardstick, and a champion's score must not depend on where a flood happened to land.
- `SIM_VERSION` 14.
  - The world hash now covers biomes, the climate state and the climate stream.
  - Golden hashes re-recorded, plus a new `climate` golden scenario with frequent natural disasters, short years and spectator events.
  - The pinned cross-engine replay now contains spectator events.

## What was done

As designed.

**Tests:**
- `climate.test.ts` (14):
  - Winter: the season, and a spectator winter's regrowth.
  - Drought: area, sand food, water field, end.
  - Flood: area, food lost, walkable, land and food back, water field.
  - Oldest-first overlap, in both orders.
  - Food zone: faster regrowth, a spectator move, natural start on land and moves.
  - Same seed gives the same natural disasters; nothing happens with climate off.
  - Off-map events are refused without a change; a generation start restores the map; a shared map is never changed.
  - Climate is in the hash; the arena has no climate.
- `replay.test.ts`:
  - Bad events are refused: kind, tick range, order, coordinates.
  - A replay with events round-trips and plays to the same hashes. Without its events, or with one moved by a tick, it mismatches.
- `replay-cross-engine.test.ts`: the pinned replay with events reaches the same final hash in Node, Chromium, Firefox and WebKit.
- `golden-hash.test.ts`: the climate scenario.
- `sim-runner.test.ts`:
  - The worker records events, with a hash before each. The export plays back exactly in Node and in the worker.
  - Spectator events are ignored during a replay. Without the events the file mismatches at the first event.
- `climate-overlay.test.ts` (3): the overlay shapes and HUD summary.
- e2e: place a flood with a map click, start a winter, cancel with Escape.
- `fitness.test.ts`: the oasis exploit world, one grass and one water tile, now runs without climate, because a single flood or drought would end it.

**Learning still works with climate on:**
- The seed-42 regression test (Small, 100 generations: ≥ 2× the generation-1 arena score, and every tribe ≥ 1.5×) passes, with training under climate and the arena without.
- It missed by 1.6% while the arena still had climate (1,346 against 1,368), which is what led to the arena decision.
- This is one seed; no multi-seed A/B was run.

**Speed:** `pnpm bench` with climate on gives Large 1,015 and Huge 362 CPU ticks/s (targets 400 and 150).

**Verification:**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (432 in 55 files) and `pnpm build` pass.
- `pnpm test:browser` passes (33, in Chromium, Firefox and WebKit).
- `pnpm test:e2e` passes (16, with 2 perf tests skipped). Two runs in review pass 2 timed out on 5 s waits under the machine's load (a Huge preset switch, the first frames). Both tests passed alone and the whole suite passed on re-run, and Huge world creation takes as long as before this sprint.

## Retro

**Went well**
- Climate as a pure layer over the generated map: it restores from the original and applies events oldest first. Undoing a disaster is the same code as applying one, and overlap order is explicit.
- Recording a hash before each spectator event made exports end exactly where the user stopped.

**Surprises / learnings**
- The first export test failed: an event applied after the last tick changed the world, so the export's final hash didn't match a replay that leaves that event out.
- Climate in the benchmark arena made the yardstick noisier. Keeping the arena calm is a design decision, recorded in the phase file.

## Reviews (2026-11-25)

Two review passes in this session.

**Pass 1** — two fixes:
- **Old run files got a confusing error.** Resuming a run saved before this sprint (simVersion 13) failed on the missing `state.rng.climate` instead of saying it was saved by another simVersion. `parseRunState` now checks the version before reading the state. Test added.
- **Hover showed the generated terrain only.** The terrain textures show the map as generated, so hovering a flooded tile said "Grass" and nothing else. The hover line now also names the events covering the tile, such as "flood here" (`climateAt`, unit tested).

Checked and fine:
- Ended events are undone using only the events still active, and overlap applies oldest first.
- The worker's hashes stay in tick order, and an event at a 500-tick checkpoint isn't hashed twice.
- Natural draws use only the `climate` stream.
- Terrain is restored before spawning at each generation start.
- Sensors, drinking and walkability read the live terrain.

**Pass 2** — two fixes:
- **A pending placement survived a new world.** An armed Drought, Flood or Food zone stayed armed after loading another world or a replay, so the next map click would still try to place it. Starting a run now clears it.
- **Test gap:** a worker test now covers world events in random mode (applied, with nothing to export) and stale run ids.

Checked and fine:
- On resume, the world constructor's food-zone draw is overwritten by the captured `climate` stream, and the generation start redraws the same zone. The resume and golden tests cover this.
- `worldEvent` carries a control sequence number, and the worker answers with a snapshot that acknowledges it.
- An event dropped where nothing changes, such as a drought on dry land, is still a recorded event and plays back the same.
