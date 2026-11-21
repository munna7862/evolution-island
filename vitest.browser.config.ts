import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Runs determinism tests inside real browser engines (plan §5 "Cross-engine"): the same test files
 * that `pnpm test` runs in Node, so Node and each browser must produce the same pinned hashes.
 * Kept out of `pnpm test` so that suite needs no browser; run with `pnpm test:browser`.
 * Firefox and WebKit join as extra instances with the cross-engine replay suite (Sprint 5.2).
 */
export default defineConfig({
  test: {
    name: 'browser',
    include: ['packages/sim-core/test/golden-hash.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
