import { defineConfig } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_DB, FRONTEND_BASE, UNREACHABLE_BASE } from './e2e/harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: FRONTEND_BASE,
  },
  webServer: [
    {
      command: 'node deploy/start.mjs',
      url: `${FRONTEND_BASE}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: ROOT,
      env: {
        BACKEND_PORT: '8179',
        BACKEND_HOST: '127.0.0.1',
        FRONTEND_PORT: '8180',
        DATABASE_PATH: E2E_DB,
      },
    },
    {
      // A second frontend that has no reachable backend behind it.
      // FRONTEND_DIR is deliberately NOT set: this runs the serve.mjs
      // default (its own frontend/ directory) exactly as `npm run serve` does.
      command: 'node frontend/serve.mjs',
      url: `${UNREACHABLE_BASE}/index.html`,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: ROOT,
      env: {
        PORT: '8181',
        BACKEND_URL: 'http://127.0.0.1:9',
      },
    },
  ],
});