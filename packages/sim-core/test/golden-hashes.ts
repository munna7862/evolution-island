/**
 * Golden state hashes for one fixed scenario, shared by the Node test (golden-hash.test.ts) and
 * the browser test (packages/viewer/e2e/smoke.spec.ts). Together they prove that Node and the
 * browser simulate bit-for-bit the same world, which replays and trainer runs rely on.
 *
 * If a test against these values fails, simulation behaviour changed. That is only allowed
 * together with a SIM_VERSION bump (CLAUDE.md): bump it in src/version.ts, then update
 * `simVersion` and the hashes below in the same commit. Never update the hashes alone.
 */
export const GOLDEN = {
  simVersion: 3,
  preset: 'small',
  seed: 42,
  mapHash: 'be9215703a745890',
  /** `world.hash()` after N ticks with the default (random) policy. */
  worldHashes: {
    0: '00305384dc1ca237',
    100: '5fc05bf30421030c',
    600: '3784c96579fd0acf',
  },
} as const;
