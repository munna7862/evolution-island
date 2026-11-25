# Evolution Island — Master Plan

> Working title. A browser-based evolution simulation where tribes of small AI creatures learn to survive and compete on Age-of-Empires-style maps, and humans watch them evolve.

---

## 1. Vision

Build an open-world 2D simulation where **AI creatures start knowing nothing** and, through **neuroevolution**, learn to find food, drink water, defend territory, cooperate with their tribe and fight rivals — all **without hand-coded strategies**.

The fun is in **watching**: generation counters, rising and falling strategies, tribe wars, extinctions and surprising exploits.

### Goals
- Classical AI only (no paid APIs) for the core game → runs free on a normal PC/browser.
- Creatures **learn by themselves** across generations.
- Multiple map sizes: **Small / Medium / Large / Huge**.
- A spectator UI that makes evolution easy to follow and enjoyable.
- Deterministic simulation (same seed + config + sim version → same result, in Node **and** in every major browser) so runs can be replayed, tested and shared.

### Non-goals (for v1)
- No 3D graphics, no multiplayer humans, no real-time human control of creatures.
- No LLMs in the core loop (optional "LLM Chiefs" phase at the end).
- No mobile-first UI (desktop browser first).

---

## 2. Core Game Design

### 2.1 World
- Grid of square tiles, generated from a **seed** using simplex noise (elevation + moisture), with a **radial falloff** so the map is an island ringed by deep water (no special map-edge handling needed).
- **Biomes:**

| Biome    | Walkable | Notes                                   |
|----------|----------|-----------------------------------------|
| Deep water | No     | Natural barrier; drinkable from an adjacent tile |
| Shallow water | Yes (slow¹) | Drinkable                         |
| Sand     | Yes      | Little food                             |
| Grass    | Yes      | Food spawns, regrows                    |
| Forest   | Yes (slow¹) | Rich food; creatures inside are only visible from ≤ half the normal vision radius (hiding) |
| Mountain | No       | Barrier, creates chokepoints            |

¹ *Slow* = entering the tile costs 2× movement energy and the creature cannot move again on the next tick.

- **Resources:** food is a per-tile amount (0..max) on grass/forest (a little on sand) that **regrows** toward its max; water is infinite. `DRINK` works when on or 4-adjacent to any water tile (N/E/S/W, matching movement).
- **Contested hotspots:** a few high-yield food patches ("oases") placed roughly equidistant between start zones, so tribes have a reason to meet (like contested resources in AoE).
- **Climate cycle (later phase):** summer/winter phases within a generation; winter slows food regrowth → scarcity pressure. *(The word "season" is reserved for climate; the evolution unit is a "generation", §2.5.)*

### 2.2 Map presets

| Preset | Tiles   | Tribes | Creatures / tribe (start) | Total | Generation length | Purpose                       |
|--------|---------|--------|---------------------------|-------|-------------------|-------------------------------|
| Small  | 64×64   | 2      | 25                        | 50    | 3,000 ticks       | Dev, debugging, fast evolution |
| Medium | 128×128 | 4      | 50                        | 200   | 4,000 ticks       | **Main show**                  |
| Large  | 256×256 | 6      | 80                        | 480   | 6,000 ticks       | Wars, migrations, territory    |
| Huge   | 512×512 | 8      | 150                       | 1,200 | 8,000 ticks       | Epic long runs, highlights     |

**Rules:**
- Keep density roughly constant; scale food with map area. *Measured on the generator (Sprint 1.1):* ~29–32 **walkable** tiles per starting creature on Small/Medium, ~50 on Large, ~77 on Huge (the 80–220 first estimated counted raw grid tiles, including the deep-water ring). Accepted for now: food regrowth capacity is several times what the starting population burns (Small: ~1,170 food tiles × 0.15 regrowth/tick ≈ 175 energy/tick vs ~30/tick needed by 50 creatures). Revisit in Sprint 3.4 tuning if crowding or the population cap (2× start) makes Small/Medium too tight. *(Sprint 3.4: left as is; the levers that mattered were metabolism, generation length and the GA settings.)*
- Minimum **25 creatures per tribe** for genetic diversity (except in battle-royale mode).
- **Population cap per tribe** = 2× starting size, so no tribe can flood the map. Tribe sizes are re-allocated by performance each generation (§2.5), so the *total* stays roughly constant. On Small (2 tribes × 25, minimum 25) there is no room to re-allocate, so tribe sizes stay fixed there — fine for a dev map.
- Tribes spawn in balanced, spread-out start zones (like AoE player starts). The generator checks that all zones are connected by walkable tiles, that each zone has similar food and water within radius R (±15%), and that each zone has free walkable tiles for at least 2× the tribe's population cap (one creature per tile). If not, it retries with the next derived seed (still deterministic).
- Generation length scales with map size so tribes have time to reach each other on big maps.
- Generation length is several times what an untrained creature lives (~500–700 ticks), so finding food and water again and again, not starting reserves, decides fitness. Sprint 3.4 doubled the first defaults (1,500/2,000/3,000/4,000): on Small, 1,500 → 2,000 → 3,000 ticks took the seeds meeting the Sprint 3.4 bar from 1 → 9 → 15 of 20.

### 2.3 Creatures

**Stats:** `health`, `energy` (food), `hydration` (water) — each 0..100 — plus `age`, `tribeId`, `position`, `lastMoveDir` (rendering only).

- Energy and hydration drain every tick; when either reaches 0, health drains.
- Health regenerates slowly while energy and hydration are both above 50%.
- Health 0 → death. `maxAge` ≥ generation length (old age only matters in the optional continuous mode, §10).
- Moving costs energy; standing still costs less; `ATTACK` costs energy.
- **Balance rule:** a creature that never eats or drinks must die well before the shortest generation ends (e.g. within ~600 ticks, even when standing still). Otherwise standing still for a whole generation scores better than foraging.
- **Max one creature per tile.** Moving into an occupied tile fails (creature stays). This makes chokepoints, blocking and defending real.
- **Vision:** `visionRadius` tiles (default 8, config). Creatures in forest are only seen within `visionRadius / 2`.

**Sensors (neural network inputs, normalized −1..1) — 18 inputs:**
1. Own energy
2. Own hydration
3. Own health
4–5. Offset (dx, dy) ÷ visionRadius to the nearest *other* tile in vision holding at least `minVisibleFood` (default: one full bite) (0, 0 if none). The own tile is left to input 14.
6–7. Offset to nearest water within vision (0, 0 if none) — creatures can't sense water they can't see
8–9. Offset to nearest ally
10–11. Offset to nearest enemy
12. Enemies in vision radius (count, scaled and clamped to 0..1)
13. Allies in vision radius (count, scaled and clamped to 0..1)
14. Food amount on current tile (0..1) — *"can I EAT here?"*
15. Water reachable (1 if on/next to water) — *"can I DRINK here?"*
16. In forest (1/0)
17. Enemy adjacent (1 if an enemy is in the 8 surrounding tiles) — *"can I ATTACK?"*
18. Bias (constant 1)

*Why flags instead of one "tile type" number:* a single number for a category implies a fake ordering (sand < grass < forest) that the network has to unlearn. Flags 14–15 also remove the ambiguity of a (0, 0) food/water offset meaning both "none visible" and "standing on it"; the food offset skips the own tile entirely, so its (0, 0) always means "no worthwhile food in sight". Ally/enemy (0, 0) is unambiguous because tiles hold one creature.

*Why a food threshold:* almost every land tile carries some food, and grazed tiles start regrowing at once, so "nearest tile with any food" read (0, 0) for 78–90% of creatures on Small/Medium. Requiring one full bite turns it into a direction to the next real meal.

*Optional:* memory and signal inputs (see **Memory & signals** below); an oscillator input (idea only).

**Actions (outputs, pick highest — argmax, ties → lowest index):**
`MOVE_N`, `MOVE_E`, `MOVE_S`, `MOVE_W`, `STAY`, `EAT`, `DRINK`, `ATTACK`, `SHARE`

- Invalid actions (eat with no food, walk into a mountain or occupied tile) become `STAY`.
- `ATTACK` hits the adjacent enemy (8-neighbourhood) with the lowest health (tie → lowest id) for `attackDamage`. The killing blow gets the kill and a fraction of the victim's remaining energy.
- `SHARE` gives `shareAmount` energy to the adjacent ally with the lowest energy, at `shareEfficiency` (e.g. 80%), **only if that ally is below 50% energy** — prevents two allies passing energy back and forth to farm fitness.

**Memory & signals (experiments, off by default — Sprints 3.5 and 4.3):**
- **Memory (Sprint 3.5):** 2 extra outputs, squashed to −1..1, are fed back as 2 extra inputs on the next tick. A creature can keep heading toward water that has gone out of sight, or "remember" being attacked. No meaning is programmed in — evolution decides what the values are used for.
- **Signals (Sprint 4.3):** 1 extra output is a **call** (0..1; below `callThreshold` = silent). Allies within `callRadius` (default 16 — farther than vision, so a call can bring help from out of sight) hear it through 3 extra inputs: the loudest call as heard (strength fades with distance) and its offset (dx, dy) ÷ callRadius. Calling costs a little energy (`callCost`) so calls aren't free noise. Enemies can't hear calls in v1.
- Calling is **not** one of the argmax actions: a creature can move *and* call in the same tick. Argmax runs over the 9 action outputs only; memory and call outputs are read as values.
- Memory and calls produced on a tick are only sensed on the **next** tick, so the two-phase tick stays independent of update order.
- Both are config switches, added through genome migration (zero weights), so trained tribes behave exactly as before when a feature is switched on. Each is kept only if the benchmark arena shows it helps (§4).

### 2.4 Brain
- **v1:** fixed-topology neural network: 18 inputs → 1 hidden layer of 12 neurons (+ a bias unit) → 9 outputs = 18×12 + 13×9 = **333 weights**, stored as a flat `Float32Array` = the creature's **genome**.
- With memory and signals both on: 23 inputs → 12 hidden → 12 outputs (9 actions + 2 memory + 1 call) = 23×12 + 13×12 = **432 weights**.
- Hidden activation: **softsign** `x / (1 + |x|)` (or a rational tanh approximation), **not** `Math.tanh` — see §3.3 for why.
- Outputs: the 9 action outputs are linear (only their order matters for argmax); memory and call outputs are squashed with softsign.
- All 9 action outputs exist from Sprint 3.1. `ATTACK` and `SHARE` act as `STAY` until Sprint 4.1, so the genome layout doesn't change when combat arrives.
- Genome files carry a **brain spec** (inputs / hidden / outputs + version), so old genomes are detected and can be migrated (e.g. a new input gets zero weights → behaviour unchanged).
- **v2 (later phase):** NEAT (topology also evolves).

Written from scratch in TypeScript (small, fast, no dependency risk).

### 2.5 Evolution — Generations
- One **generation** = `generationLength` ticks (per preset, §2.2). A generation ends early if every creature is dead, or, in battle royale, when only one tribe is left (that tribe wins and the run ends).
- **World reset at generation start (v1):** food back to full, territory cleared, creatures spawn at seeded random positions in their tribe's start zone. Every generation is a fair, comparable trial. *(A persistent "continuous" mode with births is an open decision, §10.)*
- Each tribe has its **own gene pool** — tribes evolve separately but compete in the same world.
- **Fitness** (per creature):
  `fitness = ticksAlive + 2·foodEaten + 1·waterDrunk + 5·alliesHelped + 10·kills`
  (weights are tunable in config — reward design is part of the fun; `alliesHelped` and `kills` stay 0 until Sprint 4.1).
  - `foodEaten` / `waterDrunk` = energy / hydration **actually gained** (capped at max) ÷ bite size — not the number of `EAT`/`DRINK` actions. Otherwise a creature standing in a lake spamming `DRINK` earns +1 every tick.
  - `alliesHelped` = valid `SHARE`s only (recipient below 50% energy), capped per generation.
  - Optional tribe term `+ w·tribeScore` (default 0; switched on in Sprint 4.3): shares the tribe's success with every member, which helps cooperation evolve. Useful calls only evolve when helping the tribe also pays off for the caller.
- At generation end, per tribe:
  1. Rank creatures by fitness (ties → lower id). Dead creatures keep the fitness they earned.
  2. Parents are picked by tournament (best of 3 random members; truncation of the top 20% available in config). Elitism: best 2 copied unchanged.
  3. Fill the tribe with offspring: crossover of two parents + mutation (Gaussian noise, σ ≈ 0.6, on ~5% of weights; weights clamped to ±4; generation-1 weights uniform in ±1). The noise is an Irwin–Hall sum of 12 uniforms (only `+`/`−`, §3.3); Box–Muller would need `Math.log`/`cos`.
     - Crossover is **per hidden neuron** (the child takes each hidden neuron's incoming + outgoing weights from one parent), which scrambles fixed-topology nets far less than per-weight crossover. Crossover can be switched off — mutation-only is a valid baseline.
- **Tribe sizes next generation:** the total creature budget is split between tribes in proportion to **tribe score** (survivors + food gathered + territory), clamped to [`minTribeSize`, `popCap`] with one scale factor for all tribes (size = clamp(λ·score)), so places the cap takes from a leader go to the others. Doing well as a tribe = more members next generation. *(Without this, every tribe would reset to the same size and tribes would never really win or lose.)*
- **Extinction** (no survivors at generation end):
  - Normal mode: the tribe returns at `minTribeSize`: its best hall-of-fame genome unchanged, the rest bred from this generation's members as usual. (Until creatures outlive a whole generation, "extinct" is the normal state, so the hall of fame must not take over the parent pool.) If **every** tribe went extinct, sizes are split by tribe score as usual instead, so the total population doesn't shrink. When one tribe alone survives, the total can still drop (Medium: 3 × 25 + cap 100 = 175 of 200) — accepted until the Sprint 4.2 balance pass.
  - Battle-royale mode: the tribe is eliminated.
- **Hall of fame:** every N generations each tribe's champion is benchmarked (below), and the tribe keeps its top K **distinct** genomes by **benchmark score** (the arena is deterministic, so a champion already in the hall of fame keeps its stored score and is not added twice). Raw fitness from different generations can't be compared, because the opponents keep changing. Used for respawn and "watch the champion".
- **Benchmark arena:** tribes co-evolve, so raw fitness rises and falls with the arms race and is a poor progress signal. At generation 1 and every N generations, each tribe's champion runs in a **fixed scenario** (fixed seed; alone while foraging-only, later against a frozen reference tribe) and the score is recorded. This is the "is it actually learning?" metric. *Foraging-only arena (Sprint 3.2):* a fixed-seed map of the run's preset, the champion cloned `startingCreaturesPerTribe` times into tribe 0's start zone, one generation; score = the clones' mean fitness (cloning averages out spawn luck).

### 2.6 Tribes & competition
- **Territory:** a tile belongs to the tribe that last visited it, but ownership **fades** after `territoryDecayTicks` without a visit — territory means sustained presence, not a trail of footprints. Territory % = owned walkable tiles ÷ walkable tiles, recalculated every K ticks.
- **Combat:** `ATTACK` on an adjacent enemy deals damage; the kill gives the attacker energy (rules in §2.3).
- **Cooperation:** `SHARE` transfers energy to an adjacent ally in need (rules in §2.3).
- **Tribe score** (drives next-generation tribe size): survivors + food gathered + territory %, weights in config.
- **Leaderboard:** population, territory %, average fitness, benchmark score, kills, generation number.

### 2.7 What behaviour to expect
Setting expectations up front, so tuning effort goes to the right places:
- **Very likely:** seeking food and water, avoiding starvation, staying near food-rich areas, attacking when adjacent, fleeing when weak.
- **Plausible with tuning:** clustering with allies, contesting hotspots, blocking chokepoints, sharing within groups.
- **Possible once memory and signals are on (Sprints 3.5, 4.3):** returning to water that is out of sight, alarm calls when enemies appear, allies gathering at a call.
- **Unlikely without extra work:** coordinated group tactics (flanking, planned raids). One call channel and 2 memory values are a small vocabulary. Further levers: NEAT (Phase 8) and LLM Chiefs (Phase 9).

---

## 3. Technical Architecture

### 3.1 Stack
| Area        | Choice                                   |
|-------------|------------------------------------------|
| Language    | TypeScript (strict)                      |
| Monorepo    | pnpm workspaces                          |
| Simulation  | Pure TS package, no DOM, deterministic   |
| RNG         | sfc32 (128-bit state), seeded via a string/integer hash (e.g. cyrb128) |
| Trainer     | Node.js (headless, fast-forward; `worker_threads` for multi-seed runs) |
| Viewer      | Vite + PixiJS (WebGL)                    |
| Charts      | uPlot (lightweight, fast)                |
| Map noise   | Self-contained 2D simplex noise in `sim-core` (fed by the seeded RNG; zero external deps) |
| Threading   | Simulation in a Web Worker; main thread renders |
| Unit tests  | Vitest                                   |
| Property tests | fast-check                            |
| E2E / visual| Playwright (Chromium, Firefox, WebKit)   |
| CI          | GitHub Actions                           |

*Why not mulberry32:* its 32-bit state has a period of ~4 billion draws. A long Huge run (≈ 1,200 creatures shuffled every tick for millions of ticks) can get close to that and start repeating.

### 3.2 Repo structure
```
evolution-island/
├── packages/
│   ├── sim-core/          # world, creatures, brain, evolution — pure & deterministic
│   │   ├── src/
│   │   │   ├── rng.ts           # seeded PRNG (sfc32) + named sub-streams
│   │   │   ├── hash.ts          # state hash for determinism tests & replays
│   │   │   ├── map/             # noise, biomes, presets, spawn zones, water distance field
│   │   │   ├── world.ts         # World state + tick()
│   │   │   ├── spatial-grid.ts  # fast neighbour lookup
│   │   │   ├── creature.ts
│   │   │   ├── sensors.ts
│   │   │   ├── actions.ts
│   │   │   ├── brain.ts         # neural net forward pass
│   │   │   ├── genome.ts        # crossover, mutation, brain spec + migration
│   │   │   ├── evolution.ts     # generation end, selection, tribe sizes, hall of fame
│   │   │   ├── benchmark.ts     # benchmark arena
│   │   │   └── config.ts
│   │   └── test/
│   ├── trainer/           # Node CLI: run N generations headless, save genomes
│   ├── viewer/            # Vite + PixiJS spectator app
│   └── shared/            # types, serialization (genomes, snapshots, replays), worker message protocol
├── docs/
│   ├── master-plan.md     # this file
│   ├── phases/            # one phase plan per phase
│   └── sprints/           # sprint plans + retros
├── CLAUDE.md              # rules for Claude Code
└── .github/workflows/
```

### 3.3 Key rules
- **Determinism:**
  - No `Math.random()`, `Date.now()` or `performance.now()` inside `sim-core`. All randomness comes from the seeded RNG.
  - **Separate RNG streams** derived from the master seed (map, spawn, evolution, tick). Adding one random draw to the map generator must not change every evolution result after it.
  - **Engine-independent math only:** `+ − × ÷` and `Math.floor/ceil/round/abs/min/max/sqrt/imul/fround`. **No `Math.exp/tanh/sin/cos/pow/log`** in `sim-core` — JS engines may return slightly different results for these, which would silently break replays between the Node trainer and the viewer in Firefox or Safari.
  - Deterministic ordering everywhere: ties broken by id, stable sorts, no iteration over unordered data.
  - Enforced by an ESLint rule (`no-restricted-properties` / `no-restricted-globals`) scoped to `sim-core`.
  - Third-party code used by `sim-core` (e.g. `simplex-noise`) must follow the same math rules — check it, or vendor a copy.
- **Two-phase tick:** all creatures sense and decide from the **same** world state, then actions resolve in a **seeded, per-tick shuffled order**. A fixed id order would give low-id creatures a permanent first-move / first-strike advantage.
- **Outside input only between ticks:** spectator events and speed changes are applied between ticks and recorded with their tick number, so replays can reproduce them.
- **Separation:** `sim-core` never imports rendering code. Viewer only reads snapshots (plus on-demand queries such as "inspect creature 42").
- **Snapshots:** `World.snapshot()` returns compact typed arrays, **transferred** (not copied) to the renderer. Terrain is sent once; the food layer at a lower rate.
- **Config-driven:** all balance numbers (drain rates, fitness weights, mutation rate) live in `config.ts` and presets.
- **Versioned files:** genomes, runs and replays carry `simVersion`, the brain spec and a config hash.

### 3.4 Simulation loop (pseudo)
```ts
function tick(world: World) {
  world.regrowResources();                 // depleted tiles only (active list)
  world.grid.rebuild(world.creatures);

  // Phase A — sense & decide: everyone sees the same state
  for (const c of world.livingCreatures()) {          // id order
    const out = c.brain.forward(readSensors(world, c)); // sensors read last tick's memory & calls
    c.intent = argmax(out.actions);                     // the 9 action outputs only
    c.nextMemory = out.memory; c.nextCall = out.call;   // when enabled (Sprints 3.5 / 4.3)
  }

  // Phase B — resolve in a seeded shuffled order (no permanent id advantage)
  for (const c of world.rng.tick.shuffle(world.livingCreatures())) {
    if (!c.alive) continue;                // may have been killed earlier this tick
    applyAction(world, c, c.intent);       // validated by rules; occupancy & territory stamps updated live
  }

  for (const c of world.livingCreatures()) applyMetabolism(c);  // drain, regen, age, death
  world.commitMemoryAndCalls();            // this tick's memory & calls become readable next tick
  if (world.tickCount % config.territoryInterval === 0) world.updateTerritory();  // fade old stamps, recount %
  world.tickCount++;
  if (world.generationOver()) runGenerationEnd(world);          // length reached or all dead
}
```

### 3.5 Data model (sketch)
```ts
interface Creature {
  id: number; tribeId: number;
  x: number; y: number; lastMoveDir: number;
  health: number; energy: number; hydration: number; age: number;
  alive: boolean;
  intent: number;                        // action chosen in phase A
  memory: Float32Array; call: number;    // values from last tick (Sprints 3.5 / 4.3)
  nextMemory: Float32Array; nextCall: number;
  genome: Float32Array;
  stats: { foodEaten: number; waterDrunk: number; kills: number; alliesHelped: number; callsMade: number; ticksAlive: number };
  parentIds: [number, number] | null;    // for family tree
}

interface Tribe {
  id: number; name: string; color: number;
  generation: number;
  size: number;                          // allocated size for this generation
  alive: boolean;                        // false only in battle royale
  hallOfFame: { genome: Float32Array; benchmarkScore: number; generation: number }[];
  history: GenerationStats[];
}

interface GenerationStats {
  generation: number; population: number; avgFitness: number;
  maxFitness: number; benchmarkScore: number;
  territoryPct: number; kills: number; deaths: number;
}
```
Lineage is kept only for hall-of-fame ancestors, so memory doesn't grow with every creature ever born.

### 3.6 Performance targets
**Speed:** 1× = 10 ticks/sec. Speeds: 1×, 2×, 5×, 20×, **Max** (as fast as possible, rendering throttled). Speed is best-effort; the HUD shows actual ticks/sec.

| Preset | Browser: fps / fastest smooth speed | Headless trainer  | 500 generations (trainer) |
|--------|-------------------------------------|-------------------|---------------------------|
| Small  | 60 fps / 20×                        | > 2,000 ticks/sec | ≈ 12 min                  |
| Medium | 60 fps / 20×                        | > 1,000 ticks/sec | ≈ 33 min                  |
| Large  | 60 fps / 20×                        | > 400 ticks/sec   | ≈ 2 h                     |
| Huge   | ≥ 30 fps / 5×                       | > 150 ticks/sec   | ≈ 7.4 h                   |

The 500-generation column is the worst case at the target speed with every generation running its full length (§2.2, doubled in Sprint 3.4); early generations end sooner because everyone dies.

At these targets the neural networks are cheap (Huge ≈ 180k brain evaluations/sec × 330–430 multiply-adds ≈ 60–80M ops/sec). Sensors, food and rendering are the real costs, so:
- **Terrain** is rendered once into chunked textures — never one sprite per tile (Huge has 262,144 tiles). Creatures use batched sprites; off-screen chunks are culled.
- **Smooth movement:** creature positions are interpolated between ticks, so movement looks smooth at 60 fps even at 1× (10 ticks/sec).
- **Water is static** → precompute "offset to nearest water" for every tile at map generation (O(1) sensor lookup, reported as none when beyond vision; recompute after floods).
- **Nearest food** → ring search outward over the tile grid with early exit.
- **Food regrowth** → only depleted tiles (active list), not every tile every tick.
- **Territory** → recalculated every K ticks, not every tick.

---

## 4. Phases & Sprints

Each sprint ≈ one focused Claude Code session (or a few). Every sprint ends with: tests green, a short demo, and a retro note in `docs/sprints/`.

**Size:** 19 sprints to M5 "Spectator ready" (Phases 0–6), 21 to M6 "Epic scale" (Phase 7). Phases 8–10 are optional.

### Phase 0 — Foundation
**Sprint 0.1 — Repo setup**
- pnpm monorepo, TS strict, ESLint + Prettier, Vitest, fast-check, Playwright, GitHub Actions CI.
- ESLint determinism rule for `sim-core` (§3.3).
- `CLAUDE.md` with project rules (Section 7).
- ✅ Done when: `pnpm test` and `pnpm build` pass in CI on an empty skeleton, and a `Math.random()` call in `sim-core` fails lint.

### Phase 1 — The World
**Sprint 1.1 — Seeded RNG + map generator**
- sfc32 RNG with named streams, simplex noise elevation/moisture → biomes, island falloff.
- Map presets (Small/Medium/Large/Huge) with balanced tribe spawn zones and contested hotspots; fairness check + deterministic retry.
- Precomputed nearest-water field.
- ✅ Same seed → identical map (test with hash). All spawn zones connected (flood-fill test). Food/water near each zone within ±15%. Water field correct on hand-made mini maps.

**Sprint 1.2 — Viewer v0**
- Vite + PixiJS app rendering the tile map from chunked textures; pan + zoom; preset + seed selector.
- A debug hook (e.g. `window.__ei`) exposing map hash, tick and population for tests.
- ✅ Playwright smoke test: app loads, map renders, switching preset re-renders (asserted via the debug hook, not pixel diffs).

### Phase 2 — Creatures (no learning yet)
**Sprint 2.1 — Creatures, metabolism, actions**
- Creature model, energy/hydration/health drain and regen, death, food regrowth.
- Actions with rule validation (can't walk into mountains or occupied tiles, can't eat with no food).
- Random-action "brains" to prove the loop.
- ✅ Unit tests for each action and metabolism rule.

**Sprint 2.2 — Spatial grid + sensors**
- Spatial hash grid for nearest ally/enemy; ring search for food; water field lookup.
- Sensor vector exactly as in §2.3.
- ✅ Sensor unit tests on hand-made mini maps. Benchmark: all sensor reads for Huge at ≈ 1,400 creatures (the most tribe sizes can add up to) < 2.5 ms/tick (Node).

**Sprint 2.3 — Simulation in a Web Worker + minimal HUD**
- Worker runs the two-phase `tick()`, transfers snapshots; viewer renders creatures as tribe-coloured sprites, interpolated between ticks.
- Play / pause / speed controls (1×, 2×, 5×, 20×, Max).
- Minimal HUD: tick, generation, population per tribe, actual ticks/sec — so later sprints are watchable before Phase 6.
- ✅ 60 fps on Medium with 200 random creatures. Changing speed mid-run does not change the state hash at tick N.

### Phase 3 — Brains & Evolution
**Sprint 3.1 — Neural network brain**
- Fixed-topology MLP forward pass on `Float32Array` genome (softsign); argmax over all 9 action outputs (`ATTACK`/`SHARE` act as `STAY` until Sprint 4.1); brain spec in genome files.
- ✅ Deterministic forward pass tests; performance benchmark.

**Sprint 3.2 — Generations & genetic algorithm**
- Fitness (effective intake), selection, elitism, per-neuron crossover, mutation, per-tribe gene pools.
- Tribe-size re-allocation, extinction handling (respawn / battle-royale toggle), hall of fame, benchmark arena.
- ✅ Evolution test: on a Small map (fixed seed), the benchmark-arena score at generation 50 > generation 1. Exploit tests: spamming `EAT`/`DRINK` earns no extra fitness; a creature that only `STAY`s dies well before the generation ends.

**Sprint 3.3 — Headless trainer CLI** *(moved up from Phase 5 — tuning in 3.4 and 4.2 needs hundreds of fast generations)*
- `pnpm train --preset medium --seed 42 --generations 500 --out runs/medium-42/`
- `--seeds 1-10` runs several seeds in parallel (`worker_threads`).
- Saves per-tribe hall-of-fame genomes + generation stats (JSON/CSV) every N generations.
- Viewer can load a saved generation from a run folder ("watch generation 100") — via file picker / drag-and-drop, since a browser page can't read local folders on its own.
- ✅ Trainer meets §3.6 targets for Small and Medium. Viewer plays genomes loaded from a run.

**Sprint 3.4 — First "it learns!" milestone** 🎉
- Tune config until creatures clearly learn to seek food and water.
- ✅ Benchmark score clearly rising on 20 held-out seeds (Small, 100 generations, run once): mean of the per-seed gen-100 / gen-1 ratios ≥ 2.0; ≥ 12 of 20 seeds at ≥ 2× gen 1 and ≥ 2× a STAY-only brain; ≥ 75 % of tribes at ≥ 1.5× their gen 1 (bar in `docs/sprints/sprint-3.4.md`). Visual check + recorded GIF of gen 1 vs gen 100.

**Sprint 3.5 — Memory experiment**
- 2 memory neurons (§2.3) behind a config switch; Sprint 3.4 champions migrated with zero memory weights.
- A/B in the benchmark arena: memory on vs off, 50 held-out seeds, on the normal map and on a sparse-water variant (where remembering water matters most).
- ✅ Unit tests: memory values stay within −1..1; a migrated genome with zero memory weights gives the same state hash as before migration. On held-out Small seeds 201–250, run once (tribe score = mean of its last three benchmarks): memory-on ≥ 0.95× memory-off on the normal map (100 generations); on the sparse-water map (300 generations) ≥ 1.10× memory-off and better on ≥ 30 of 50 seeds (bar in `docs/sprints/sprint-3.5.md`). If it passes, memory is switched on by default; if not, leave memory off and record why in the retro.

### Phase 4 — Tribes & Competition
**Sprint 4.1 — Combat, sharing, territory**
- ATTACK / SHARE actions, kill rewards, territory ownership with decay + %.
- ✅ Unit tests for combat & sharing; territory % sums to ≤ 100. Exploit test: `SHARE` ping-pong between two allies earns no extra fitness.

**Sprint 4.2 — Balance pass**
- Population caps, fair spawn zones, hotspots, tune fitness and tribe-score weights.
- Watch for degenerate strategies (e.g. everyone stands still) and fix rewards.
- ✅ Over 10 seeds × 200 generations on Medium (trainer): no start slot has the highest tribe score at gen 200 in more than 5 of the 10 seeds; in battle-royale mode, ≥ 2 tribes are still alive at gen 20 in ≥ 7 seeds; champions don't show a degenerate action mix (e.g. > 80% `STAY`).

**Sprint 4.3 — Signals experiment**
- Call output + "loudest ally call" sensors (§2.3) behind a config switch; Sprint 4.2 champions migrated with zero call weights.
- Tribe-score fitness term switched on and tuned — in **both** arms of the A/B, so the only difference between them is the calls.
- A/B in the benchmark arena: signals on vs off, 3 seeds.
- **Mute test:** run signal-on champions with their call inputs zeroed. If they do worse, the calls carry real information; if not, the calls are noise.
- Viewer: a ripple ring when a creature calls, so spectators can watch calls spread.
- Re-run the Sprint 4.2 balance check with signals on.
- ✅ Signal-on tribes beat signal-off tribes in ≥ 2 of 3 seeds; muting lowers the champions' score; the 4.2 balance criteria still hold. If not, leave signals off and record why in the retro.

### Phase 5 — Persistence & Replays
**Sprint 5.1 — Runs & resumable training**
- Checkpoint and resume runs; run browser in the viewer (pick run → tribe → generation); refuse or migrate files whose `simVersion` / brain spec / config hash don't match.
- ✅ Kill and resume a run → same result as an uninterrupted run.

**Sprint 5.2 — Save / load / replay**
- Export a replay from the trainer or viewer as a single shareable file, and play it back in the viewer.
- Replay files: seed + config + genomes + recorded spectator events + `simVersion` → deterministic re-run, with periodic state-hash checkpoints to pinpoint divergence.
- ✅ Replay determinism test: same replay file → same final state hash, in Node **and** in Chromium, Firefox and WebKit (Playwright).

### Phase 6 — Spectator Experience
**Sprint 6.1 — Live dashboard**
- Leaderboard (population, territory %, kills, avg fitness, benchmark score), generation counter.
- uPlot graphs: fitness, benchmark score & population per tribe over generations.
- ✅ Playwright: dashboard values update at each generation end.

**Sprint 6.2 — Creature inspector & follow-cam**
- Click a creature → stats, sensors, current action, memory and call values (if enabled), live brain activation view (queried from the worker on demand).
- Follow-cam on a selected creature or tribe champion.
- ✅ Playwright: clicking a creature opens the inspector with live values; follow-cam keeps the creature on screen.

**Sprint 6.3 — Family tree & events feed**
- Lineage tree for a tribe's champions.
- Event feed: "Blue tribe went extinct", "Red reached 40% territory", "New fitness record".
- ✅ Playwright tests for dashboard, inspector and feed.

### Phase 7 — Scale & World Events
**Sprint 7.1 — Large / Huge optimisation**
- Profiling, typed-array (struct-of-arrays) creature storage if needed, sprite batching, culling off-screen.
- ✅ Meets §3.6 targets on Large and Huge.

**Sprint 7.2 — Climate & disasters**
- Winter phase (low regrowth), droughts, floods (recompute water field), migrating food zones.
- Spectator-triggered events button (drop a disaster and watch tribes react); events are recorded in the replay at their tick.
- ✅ Unit test per event; a replay containing spectator events reproduces the same state hash.

### Phase 8 — Optional: NEAT brains
- Replace fixed MLP with NEAT (evolving topology); compare learning speed vs v1.
- ✅ Benchmark-arena comparison NEAT vs MLP over 3 seeds, written up in `docs/`.

### Phase 9 — Optional: LLM Chiefs
- One LLM "chief" per tribe, called **once per generation** with a text summary of tribe stats.
- Chief picks tribe-level policy (e.g. "expand north", "avoid Red tribe", "prioritise water").
- Policy becomes extra sensor inputs → brains learn to follow (or ignore) their chief. New inputs are added through genome migration (zero weights), so existing tribes keep working.
- Local model (Ollama) or cheap API; 2–8 calls per generation total. Runs in the trainer / locally only — never ship API keys in the static site.
- LLM output isn't deterministic, so chief decisions are **recorded in the replay** and replayed, not re-asked.
- ✅ Chief-led tribe vs no-chief tribe benchmark comparison.

### Phase 10 — Optional: Publish
- Deploy viewer as a static site (GitHub Pages / Vercel) with pre-trained runs.
- Shareable seed links: `?preset=large&seed=1234&v=<simVersion>`.
- ✅ Deployed site plays a pre-trained run; a seed link reproduces the same map on another machine.

---

## 5. Testing Strategy

| Layer          | What                                               | Tool           |
|----------------|----------------------------------------------------|----------------|
| Unit           | Rules: metabolism, actions, combat, sensors, genome ops | Vitest     |
| Determinism    | Same seed + config → same state hash after N ticks | Vitest         |
| Cross-engine   | Same replay → same hash in Node, Chromium, Firefox, WebKit | Vitest + Playwright |
| Property-based | Invariants: no creature on mountain/deep water, one creature per tile, stats in range, pop ≤ cap | fast-check |
| Exploits       | Known exploits don't pay: spam-`EAT`/`DRINK`, `SHARE` ping-pong, standing still all generation | Vitest |
| Feature experiments | Memory and signals: A/B against the feature switched off; mute test for calls | Trainer + benchmark arena |
| Evolution      | Benchmark-arena score improves over generations on fixed seeds | Vitest (slow suite) |
| Performance    | Ticks/sec benchmarks per preset, fail on regression | Vitest bench  |
| E2E / visual   | Viewer loads, controls work, dashboard updates (asserted via debug hook) | Playwright |
| CI             | Fast suite on every push; slow + perf + cross-engine suites nightly | GitHub Actions |

Notes:
- Shared CI runners are noisy: compare benchmarks against a stored baseline with a generous threshold (e.g. fail only when > 30% slower).
- Headless WebGL on CI uses software rendering (SwiftShader). Avoid pixel-diff assertions on the live canvas; if screenshots are used, only for a static map with a fixed seed and a tolerance.

---

## 6. Virtual Team (personas for Claude Code sessions)

| Persona               | Responsibility                                           |
|-----------------------|----------------------------------------------------------|
| Product Owner         | Vision, priorities, acceptance criteria, "is it fun to watch?" |
| Game Designer         | Biomes, stats, actions, balance, fitness weights         |
| Simulation Architect  | `sim-core` design, determinism, performance              |
| ML / Evolution Engineer | Brain, genome, GA, NEAT, reward design, benchmark arena |
| Frontend / Rendering Dev | PixiJS viewer, worker messaging, dashboard UI         |
| SDET                  | Test strategy, determinism & perf suites, CI, Playwright |
| Scrum Master          | Sprint plans, retros, keeping scope small                |

---

## 7. CLAUDE.md (starter rules)

```md
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
```

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Creatures don't learn anything | Start with a tiny Small map, simple rewards (food + survival only), tune before adding combat; measure with the benchmark arena, not raw fitness |
| Degenerate strategies (stand still, exploit bugs) | Reward effective intake not actions, exploit tests for every fitness term, watch replays, adjust weights |
| Tuning is open-ended (Sprints 3.4 and 4.2 can eat weeks) | Trainer CLI before tuning (Sprint 3.3), multi-seed parallel runs, timebox each tuning sprint and record what was tried in the retro |
| Tribes never meet on big maps | Generation length scales with map size, contested hotspots between start zones, later continuous mode |
| Replays break across browsers or versions | Engine-independent math, separate RNG streams, `simVersion` in every file, cross-engine determinism tests |
| Performance on Huge maps | Spatial grid from day 1, precomputed water field, chunked terrain textures, typed arrays, worker thread, render culling |
| One tribe dominates every time | Balanced spawns with fairness check, population caps, extinction respawn, seasonal scarcity |
| Memory or signals add complexity without helping (calls evolve into noise) | Both behind config switches, judged by A/B tests in the benchmark arena and the mute test; kept off if they don't help |
| Scope creep | Phases 8–10 are optional; finish Phase 6 first |
| Boring to watch | Minimal HUD from Sprint 2.3; full dashboard, events feed and follow-cam in Phase 6 |

---

## 9. Milestones

| Milestone | After | What you can show |
|-----------|-------|-------------------|
| M1 — "A world exists" | Phase 1 | Generated maps for all 4 presets |
| M2 — "Life" | Phase 2 | Random creatures living and dying |
| M3 — "It learns!" | Phase 3 (Sprint 3.4) | Gen 1 vs Gen 100 side by side |
| M4 — "Tribal wars" | Phase 4 | 4 tribes competing on Medium (calling to each other, if Sprint 4.3 works) |
| M5 — "Spectator ready" | Phase 6 | Full dashboard, inspector, family trees |
| M6 — "Epic scale" | Phase 7 | Huge map, 8 tribes, disasters |

---

## 10. Open Decisions
Most should be settled before/during Phase 1; later ones say when. Defaults are proposed so work can start; change them in the sprint retro if needed.
- [ ] Final game name
- [x] Top-down pixel art vs simple coloured shapes for creatures: simple coloured shapes (implemented Sprint 2.3)
- [x] Generation length per preset: 3,000 / 4,000 / 6,000 / 8,000 ticks (doubled in Sprint 3.4, see §2.2)
- [ ] Extinction mode default: respawn (default) vs battle royale
- [x] Tribe names & colours: Okabe-Ito-based colour-blind-safe palette plus a distinct shape per tribe; names Amber, Sky, Vermilion, Orchid, Gold, Emerald, Cobalt, Ivory (implemented Sprint 2.3)
- [ ] Generational (default for v1, world resets each generation) vs **continuous mode** (births when energy is high, death by old age, no reset). Continuous is more alive to watch on Large/Huge but harder to tune; revisit after Phase 4.
- [x] Tile occupancy: one creature per tile (implemented Sprint 2.1)
- [ ] Can enemies overhear calls? (default: no; eavesdropping is a later experiment — decide before Sprint 4.3)
- [x] Speed: 1× = 10 ticks/sec (implemented Sprint 2.3)
- [x] License: MIT, public repo on GitHub (decided 2026-11-21)

---

## 11. How to start in Claude Code

1. Turn this `evolution-island` folder into the repo (`git init`) and move this file to `docs/master-plan.md`.
2. First prompt:
   > "Read docs/master-plan.md. Act as Scrum Master + Simulation Architect. Write docs/phases/phase-0.md and docs/sprints/sprint-0.1.md, then implement Sprint 0.1 only."
3. After each sprint: review the demo, run tests, then ask for the next sprint plan.

---

## 12. Revision notes

**2026-11-21 — plan review**
- Evolution model made consistent: tribe sizes are re-allocated by tribe score each generation (population caps and "winning" now mean something); world resets each generation; extinction and hall of fame defined; benchmark arena added as the real progress metric.
- Fitness exploits closed: reward actual food/water gained (not `EAT`/`DRINK` spam); `SHARE` only counts for allies in need, with an efficiency loss and a cap.
- Sensors: "tile type" number replaced by flags; "can eat/drink/attack here" made explicit; 15 → 18 inputs; unused `facing` replaced by `lastMoveDir` (rendering only).
- Rules filled in: vision radius, forest hiding, slow tiles, one creature per tile, attack/share targeting, health regen, max age vs generation length.
- Determinism hardened: engine-independent math (no `Math.tanh` etc.), sfc32 instead of mulberry32, separate RNG streams, two-phase tick with seeded shuffle, versioned files, cross-engine tests.
- Naming: "season" now means climate only; the evolution unit is a "generation".
- Map presets: generation length per preset, density rule corrected (80–220 tiles), contested hotspots, spawn fairness check, island falloff.
- Phases: headless trainer moved to Sprint 3.3 (needed for tuning), minimal HUD added in Sprint 2.3, measurable acceptance criteria for every sprint, Phase 5 refocused on resumable runs and replays.
- Performance: defined 1× speed, chunked terrain textures, precomputed water field, active-list food regrowth, training-time estimates.
- Added §2.7 (what behaviour to expect) and new risks (tuning time, tribes never meeting, replays breaking).

**2026-11-21 — memory & signals**
- Added Sprint 3.5 (memory experiment) and Sprint 4.3 (signals experiment), both behind config switches and judged by A/B tests in the benchmark arena; signals also need a mute test.
- §2.3 defines memory neurons and calls (calls are separate from actions, heard on the next tick, and carry farther than sight); §2.4 gives the larger brain size (432 weights with both on).
- Tribe-score fitness term is switched on in Sprint 4.3. §2.7, pseudo-code, data model, tests, risks, milestones, open decisions and CLAUDE.md rules updated to match.

**2026-11-21 — second full review** (project folder renamed to `evolution-island`)
- Water sensor limited to vision range — before, creatures always knew where the nearest water was, which made memory pointless for finding water.
- Balance rule added: a creature that never eats or drinks must die well before the generation ends; otherwise standing still all generation beats foraging.
- Sprint order fixed: the `SHARE` ping-pong exploit test moved from Sprint 3.2 to 4.1 (sharing doesn't exist yet in 3.2); all 9 action outputs exist from Sprint 3.1, with `ATTACK`/`SHARE` acting as `STAY` until 4.1, so the genome layout never changes for combat.
- Hall of fame ranked by benchmark score instead of raw fitness (fitness from different generations isn't comparable).
- Spawn zones must fit 2× the tribe's population cap; Small-map note (tribe sizes can't change there); battle-royale run ends when one tribe is left.
- Calls fade with distance; output activations defined; spectator input applied only between ticks; third-party code in `sim-core` must follow the math rules.
- Browser targets now include the fastest smooth speed per preset; creature movement interpolated between ticks; Huge sensor benchmark sized at ≈ 1,400 creatures.
- Viewer loads runs via file picker / drag-and-drop; duplicate "load trained tribes" item in Sprint 5.2 replaced by replay export; Sprint 3.4 gets an example pass bar.
- Fitness term names match the data model (`ticksAlive`, `kills`); sprint count added to §4; open decisions note when they're due; new CLAUDE.md rule to keep this plan updated; §11 updated for the existing folder.

**2026-11-21 — repo published**
- Public GitHub repo created and MIT license added; the license decision in §10 is ticked.

**2026-11-21 — Sprint 1.1 (self-contained simplex noise)**
- §3.1 updated: instead of adding `simplex-noise` as an external dependency, `sim-core` includes a self-contained pure-TS 2D simplex noise implementation (`packages/sim-core/src/map/simplex.ts`) using only allow-listed `Math` members so the ESLint determinism guard checks every line.

**2026-11-21 — Phase 2 close-out** (`simVersion` 2 → 3)
- §2.3: the food-direction sensor (inputs 4–5) now targets the nearest *other* tile holding at least `minVisibleFood` (config, default one bite). Before, it read (0, 0) for 78–90% of creatures; after, for none on the same seeds.
- `DRINK` and input 15 count water on or **4-adjacent** to the creature (matching 4-way movement), as implemented since Sprint 2.1.
- Decision policies get their own `policy` RNG stream; the tick stream is used only for the Phase B shuffle.
- §2.2: density rule restated against walkable tiles with measured values; current density accepted until Sprint 3.4 tuning.
- §10: shapes, tribe names & colours, one creature per tile and 1× = 10 ticks/sec ticked (all implemented in Phase 2).
- Golden state hashes for one fixed scenario are pinned in `packages/sim-core/test/golden-hashes.ts` and checked in Node and Chromium; a behaviour change without a `simVersion` bump now fails the tests.

**2026-11-21 — Sprint 3.2 (generations & genetic algorithm)** (`simVersion` 4 → 5)
- §2.5: Gaussian mutation noise is an Irwin–Hall sum (engine-exact); the foraging-only benchmark arena is defined (champion clones, fixed map, mean fitness), and it also runs at generation 1; if every tribe goes extinct, sizes follow tribe score instead of all dropping to `minTribeSize`.
- Per-hidden-neuron crossover also flips one coin for the output biases, which belong to no hidden neuron.
- Creature ids restart at 0 each generation (`(generation, id)` identifies a creature in a run).
- Generations are driven by an `EvolutionRun` around `World` rather than inside `tick()`; `World.startGeneration` does the reset (food full, creatures respawned in their zones).
- Default `initialWeightRange` = 2: with ±1, a 4-seed sweep on Small barely learned in 50 generations (sensors hardly moved the outputs); with ±2 the benchmark rose on all 4 seeds. *(Reversed in Sprint 3.4: ±1 works better together with σ 0.6 and tournament selection.)*

**2026-11-21 — Sprint 3.2 review** (`simVersion` 5 → 6)
- §2.5 extinction: an extinct tribe's next generation is its best hall-of-fame genome plus offspring of its own members. Before, the whole hall of fame was ranked ahead of the members, filled 5 of the 6 truncation parent slots and both elite slots, and a tribe that had not had a survivor yet stopped learning (Small seed 42: tribe 1 was extinct in 50 of 50 generations, benchmark 498 → 515). Over 29 Small seeds × 50 generations, tribes improving > 1.1× went from 29/58 to 37/58.
- §2.5 tribe sizes: one scale factor for all tribes (exact clamped proportional split). The old fix-low-then-cap-high loop never gave the low tribes what the cap freed, so Medium lost 25 creatures whenever one tribe out-scored the rest (e.g. scores 750/125/125/125 → 100/25/25/25).
- For Sprint 4.2: tribe score is absolute (survivors + food), so a tribe at `popCap` out-scores equally good smaller tribes and tends to stay at the cap; consider a per-member score there.

**2026-11-21 — Sprint 3.3 (headless trainer CLI)**
- Run folder layout fixed: `run.json` (manifest + full config), `stats.json`/`stats.csv`, and `checkpoints/gen-NNNN/` holding `checkpoint.json` plus each tribe's hall-of-fame genomes as genome files; saved at generation 1, every `--save-every` generations and the last one.
- A checkpoint at generation N is the state after generation N: hall of fame + next sizes. The viewer plays it as "Gen N" (creature i runs hall-of-fame genome i mod K) with an `EvolutionRun` that keeps evolving; it is not a replay (Sprint 5.2).
- §3.6 trainer targets met with room to spare: 500 generations in 25 s on Small (≈ 30,000 ticks/s) and 2 min on Medium (≈ 8,400 ticks/s).

**2026-11-24 — Sprint 3.3 review**
- §2.5 hall of fame: distinct genomes only. An elite that was champion again at a later benchmark generation got the same score and a second slot (Small seed 42: 4 of 102 saved tribe halls of fame), and playing a checkpoint always did it, after benchmarking a known genome in the browser. Now a champion already in the hall of fame keeps its stored score: no benchmark run, no copy. World evolution is unchanged (the best entry never changes); `SIM_VERSION` 7 because saved halls of fame differ.
- Refused runs say why and what to do (train again with this build). Until Sprint 5.1 migrates files, every `SIM_VERSION` bump or default-config change makes earlier runs unplayable in the viewer.

**2026-11-24 — Sprint 3.4 ("it learns!" tuning)** (`simVersion` 7 → 8)
- New defaults, config only (no rule changed): energy drain 0.25 → 0.2, generation lengths doubled (§2.2), tournament selection (best of 3) instead of truncation, generation-1 weights ±2 → ±1, mutation σ 0.2 → 0.6. Found with the trainer's new `--config` overrides (~60 sweeps on Small, 10–40 seeds × 100 generations each): seeds meeting the Sprint 3.4 bar went from 0 of 20 to 25 of 40, and the mean generation-100 / generation-1 benchmark ratio from 1.45 to ≈ 2.3 (Medium, 6 seeds: 1.50 → 2.12).
- Why these: whole tribes used to lock into "always EAT" (eating alone added ~67 ticks of life on almost any tile, drinking only helped next to water); with energy drain 0.2 thirst kills first and that lock-in mostly disappears. Longer generations let selection reward finding water and food over thousands of ticks rather than surviving on starting reserves. Larger mutations and tournament selection get populations out of "one action forever" optima. An only-STAY creature still dies at tick 516 (§2.3 balance rule).
- Tried and dropped: cheaper moves, faster thirst, wider vision, weight clamp 8, intake weights ×5–×20, crossover off, unit-length food/water direction sensors (a local experiment; learning got worse).
- Every run trained before this is unplayable in the viewer (new `SIM_VERSION` and config hash).
- §4 Sprint 3.4 acceptance: **20 held-out seeds instead of 3** (user's decision, made before any held-out seed was run). A 100-generation outcome is still partly luck per seed (the tuned defaults met the per-seed bar on ≈ 62 % of 40 tuning seeds; about one tribe in seven locks into "always EAT" or "always DRINK"), so 3 of 3 would have passed only 25–40 % of the time. The bar is now on seeds 101–120, run once: mean per-seed ratio ≥ 2.0, ≥ 12 of 20 seeds at 2× gen 1 and 2× STAY-only, ≥ 75 % of tribes at 1.5×. Result: 2.52, 16 of 20, 30 of 40 (75 %, exactly the threshold) — met. On the held-out seeds 10 of 40 tribes stayed below 1.5× (1 in 4, more than the tuning seeds' 1 in 7); 2 of them are hard "always EAT" lock-ins, the other 8 bred creatures that lived through whole generations but their generation-100 champion scored low in the arena. Lock-in and champion noise are known limitations for Sprints 3.5 and 4.2.

**2026-11-25 — Sprint 3.5 acceptance bar** (fixed before any held-out run)
- §4 Sprint 3.5: **50 held-out seeds instead of 3** (user's decision, made before any held-out seed was run and before memory-on was trained on any seed). Memory on vs off from scratch, everything else default, on held-out Small seeds 201–250, each arm run once. A tribe's score is the mean of its last three benchmarks (damps the champion noise of Sprint 3.4). Pass: normal map (100 generations) memory-on ≥ 0.95× memory-off; sparse-water map (300 generations) memory-on ≥ 1.10× and better on ≥ 30 of 50 seeds. Measured noise between two equal memory-off arms of 50 seeds is about ±6 % (normal) and ±9 % (sparse). Hard lock-in and champion noise are reported per arm, not blocking.
- Sparse-water variant = map generator settings via `--config` (`docs/sprints/sprint-3.5/sparse-water.json`): water in sight from 70 % of spawn-zone tiles instead of 99 %, 6.6 tiles away instead of 2.6. Memory off learns slowly there (1.34× at generation 100, 1.92× at 300 on development seeds), hence 300 generations.
- If memory passes, `brain.memoryNeurons` becomes 2 by default (user's decision); if not, it stays off.
