/**
 * Version of the simulation rules. Genomes, runs and replays carry it (plan §3.3), and a file
 * whose simVersion differs from this one is refused or migrated.
 *
 * Bump it whenever the sensor list, brain spec or tick rules change (CLAUDE.md).
 * 0 = skeleton + world map generator (Phase 0–1).
 * 1 = Phase 2.1 creature model, metabolism, Phase 2 actions, and two-phase tick loop.
 * 2 = Phase 2.2 spatial grid and 18-input normalized creature sensors.
 * 3 = Phase 2 close-out: the food-direction sensor needs `minVisibleFood` and skips the own tile;
 *     the random policy draws from its own `policy` RNG stream instead of the tick stream.
 * 4 = Sprint 3.1: brain spec v1 (18 → 12 → 9 softsign MLP, hidden-neuron-major genome layout)
 *     and `brain.hiddenNeurons` in the config hash.
 * 5 = Sprint 3.2: generations — world reset at generation start (`startGeneration`), creatures
 *     carry genomes, GA settings in the config hash; genomes and `generationTick` in the world hash.
 * 6 = Sprint 3.2 review: an extinct tribe respawns as its hall-of-fame champion plus offspring of
 *     its own members (the hall of fame no longer fills the parent pool); tribe sizes use an exact
 *     clamped proportional split (the whole budget whenever min/popCap allow it).
 * 7 = Sprint 3.3 review: the hall of fame holds distinct genomes; a champion already in it keeps
 *     its stored benchmark score instead of being benchmarked and added again.
 * 8 = Sprint 3.4 tuning (config defaults only, no rule change): energy drain 0.25 → 0.2,
 *     generation lengths doubled, tournament selection, ±1 initial weights, mutation σ 0.6.
 * 9 = Sprint 3.5: memory neurons (`brain.memoryNeurons`, off by default): the brain spec grows by
 *     M inputs and M outputs, creatures carry memory written in Phase A and read on the next
 *     tick, and the world hash covers memory. With memory off creatures behave as in version 8.
 * 10 = Sprint 3.5 result: memory on by default (`brain.memoryNeurons` 2, brain 20 → 12 → 11).
 * 11 = Sprint 4.1: `ATTACK` (damage, deaths inside Phase B, kill credit and energy) and `SHARE`
 *     (need/keep rules, efficiency, alliesHelped) act; territory stamps, decay and territory %
 *     (in the world hash and the tribe outcome).
 * 12 = Sprint 4.2: battle royale eliminates only from `battleRoyaleFromGeneration`; places a capped
 *     leader can not take go to extinct tribes; the tribe outcome uses territory % averaged over
 *     the generation (sum and recount count in the world hash).
 * 13 = Sprint 4.3: signals (`signals.enabled`, off by default): call output and 3 "loudest ally
 *     call" inputs; calls committed after metabolism and heard next tick, with a per-tick cost;
 *     creatures' calls in the world hash.
 */
export const SIM_VERSION = 13;
