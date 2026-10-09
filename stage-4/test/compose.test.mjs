/**
 * Unit 8 — Process Composition (RED tests, TDD order).
 *
 * - Starts the supervisor and reaches the composed service through the
 *   frontend's /health and /v1/* proxy
 * - Exits non-zero when the backend port is already occupied
 * - Tears the whole tree down and releases both ports on SIGTERM
 *
 * All state lives in a disposable temp directory; nothing is written into the
 * product tree.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'deploy', 'start.mjs');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeout = 15000, interval = 150, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await delay(interval);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function httpHealthy(port) {
  return fetch(`http://127.0.0.1:${port}/health`)
    .then((res) => res.ok)
    .catch(() => false);
}

async function waitPortsClosed(ports, timeout = 15000) {
  await waitFor(
    async () => {
      const states = await Promise.all(ports.map((port) => httpHealthy(port)));
      return states.every((ok) => !ok);
    },
    { timeout, label: `ports ${ports.join(',')} released` },
  );
}

describe('Unit 8: Process Composition', () => {
  let dir;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tablekeeper-compose-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts the composed service and answers through the frontend proxy', async () => {
    const backendPort = await freePort();
    const frontendPort = await freePort();

    const child = spawn(process.execPath, [SUPER], {
      cwd: dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
      env: {
        ...process.env,
        BACKEND_PORT: String(backendPort),
        FRONTEND_PORT: String(frontendPort),
        DATABASE_PATH: join(dir, 'compose.db'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      // /health reaches the composed backend through the frontend proxy.
      await waitFor(() => httpHealthy(frontendPort), { label: 'frontend /health' });

      // The composed backend (stage 1 + stage 2) is reachable through the proxy.
      const response = await fetch(`http://127.0.0.1:${frontendPort}/v1/restaurants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Compose Test', timezone: 'Europe/Paris' }),
      });
      assert.strictEqual(response.status, 201, 'restaurant created through the proxy');
      const body = await response.json();
      assert.ok(/^[0-9a-f-]{36}$/.test(body.id), 'a UUID is returned');

      // The stage-2 route is present (hours were migrated).
      const availability = await fetch(
        `http://127.0.0.1:${frontendPort}/v1/restaurants/${body.id}/availability?local_date=2099-01-05&party_size=2&duration_min=60`,
      );
      assert.strictEqual(availability.status, 200, 'availability route answers');
    } finally {
      child.kill('SIGTERM');
    }

    await waitPortsClosed([backendPort, frontendPort]);
    assert.strictEqual(child.exitCode, null, 'child still terminating');
  });

  it('exits non-zero when the backend port is already occupied', async () => {
    const backendPort = await freePort();
    const frontendPort = await freePort();

    const blocker = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_OUR_SERVER' } }));
    });
    await new Promise((resolve) => blocker.listen(backendPort, '127.0.0.1', resolve));

    try {
      const child = spawn(process.execPath, [SUPER], {
        cwd: dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
        env: {
          ...process.env,
          BACKEND_PORT: String(backendPort),
          FRONTEND_PORT: String(frontendPort),
          DATABASE_PATH: join(dir, 'occupied.db'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const code = await waitFor(() => child.exitCode !== null && child.exitCode, {
        label: 'supervisor exits non-zero',
      });
      assert.notStrictEqual(code, 0, 'a failed backend must fail the supervisor');
      await delay(300);
      assert.strictEqual(child.signalCode, null);
    } finally {
      blocker.close();
    }
  });

  it('releases both ports on SIGTERM', async () => {
    const backendPort = await freePort();
    const frontendPort = await freePort();

    const child = spawn(process.execPath, [SUPER], {
      cwd: dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
      env: {
        ...process.env,
        BACKEND_PORT: String(backendPort),
        FRONTEND_PORT: String(frontendPort),
        DATABASE_PATH: join(dir, 'sigterm.db'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitFor(() => httpHealthy(frontendPort), { label: 'ready before signal' });

    // SIGTERM the supervisor. On Windows this terminates the supervisor
    // immediately; the children notice the IPC channel close and take
    // themselves down, so both ports must be released either way.
    child.kill('SIGTERM');

    await waitPortsClosed([backendPort, frontendPort]);
  });
});