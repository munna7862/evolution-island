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
 */
export const SIM_VERSION = 4;
