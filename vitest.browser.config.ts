import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Runs determinism tests inside real browser engines (plan §5 "Cross-engine"): the same test files
 * that `pnpm test` runs in Node, so Node and each browser must produce the same pinned hashes —
 * the golden scenarios and, since Sprint 5.2, a replay played to its pinned final hash — in
 * Chromium, Firefox and WebKit. Kept out of `pnpm test` so that suite needs no browser; run with
 * `pnpm test:browser`.
 */
export default defineConfig({
  // Workspace packages resolve to src/ (as in vitest.config.ts), so no build is needed.
  resolve: { conditions: ['@evolution-island/source', ...defaultClientConditions] },
  test: {
    name: 'browser',
    include: [
      'packages/sim-core/test/golden-hash.test.ts',
      'packages/shared/test/replay-cross-engine.test.ts',
    ],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
