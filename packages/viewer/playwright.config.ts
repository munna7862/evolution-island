import { defineConfig, devices } from '@playwright/test';
import { PREVIEW_PORT } from './vite.config.js';

const isCI = process.env['CI'] !== undefined;
const baseURL = `http://localhost:${PREVIEW_PORT}`;

// Sprint 0.1: Chromium smoke test only. Firefox + WebKit join with the
// cross-engine replay suite (plan §5, Sprint 5.2).
export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-unsafe-swiftshader',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    // Builds the viewer, then serves the production bundle.
    command: 'pnpm run build && pnpm run preview',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
