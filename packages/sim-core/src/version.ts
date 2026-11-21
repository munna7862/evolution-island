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
 */
export const SIM_VERSION = 6;
