// vite.config.js — how the dashboard page is built, served in development, and tested (D98).
//
// Where it sits: used by `npm run build` / `npm run dashboard` (builds the page into web/dist,
// which the api serves), `npm run dev` (Vite's development server with hot reload) and
// `npm run test:web` (Vitest, the page's tests).
// Reads: the web/ folder; API_PORT from the project's .env (for the development proxy).
// Writes: web/dist (the build).
//
// In development the page runs on Vite's own server, and every /api request is passed on
// (proxied) to the api at http://localhost:API_PORT. Start the api in a second terminal with
// `npm run api`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(WEB_DIR, '..');

export default defineConfig(({ mode }) => {
  // API_PORT from the project's .env (or the shell), default 3000 like src/config.js.
  const env = { ...loadEnv(mode, PROJECT_ROOT, ''), ...process.env };
  const apiPort = env.API_PORT || 3000;

  return {
    root: WEB_DIR,
    plugins: [react()],
    build: {
      outDir: path.join(WEB_DIR, 'dist'),
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}'],
      setupFiles: ['src/test/setup.js'],
      // Class names of CSS Modules stay readable in tests (e.g. "positive").
      css: { modules: { classNameStrategy: 'non-scoped' } },
    },
  };
});
