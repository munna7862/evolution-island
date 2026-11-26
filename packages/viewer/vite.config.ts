import { defaultClientConditions, defineConfig } from 'vite';

export const PREVIEW_PORT = 4173;

export default defineConfig({
  // Relative URLs (Phase 10): the built site works from any folder, e.g. GitHub Pages' /<repo>/.
  base: './',
  // Bundle workspace packages from src/ (see "exports" in their package.json).
  resolve: { conditions: ['@evolution-island/source', ...defaultClientConditions] },
  worker: { format: 'es' },
  preview: { port: PREVIEW_PORT, strictPort: true },
});
