import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/** Resolve workspace packages to src/ via the custom "exports" condition (no build needed). */
const SOURCE_CONDITION = '@evolution-island/source';

const PACKAGES = ['sim-core', 'shared', 'trainer', 'viewer'] as const;

export default defineConfig({
  resolve: { conditions: [SOURCE_CONDITION, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
  test: {
    // One project per package: `pnpm test --project sim-core` runs a single package.
    projects: PACKAGES.map((name) => ({
      extends: true,
      test: {
        name,
        include: [`packages/${name}/test/**/*.test.ts`],
        environment: 'node',
      },
    })),
  },
});
