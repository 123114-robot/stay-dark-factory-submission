/**
 * TableKeeper process supervisor (Stage 4 delivery).
 *
 * Three roles live in this one file:
 *
 *   (default)             supervisor: spawns the backend and frontend children,
 *                        forwards shutdown, exits non-zero if a child fails,
 *                        and reports when the composed service answers /health.
 *   node start.mjs --backend
 *                        backend child: runs the composed listener (stage 1
 *                        routes + stage 2 availability search) in this process
 *                        on BACKEND_PORT / BACKEND_HOST using DATABASE_PATH.
 *                        The stage-2 schema migration (restaurant_hours) is
 *                        applied before it serves.
 *   node start.mjs --frontend
 *                        frontend child: runs the Stage 4 static server and
 *                        proxy (serve.mjs) in this process on FRONTEND_PORT,
 *                        proxying /v1/* and /health to BACKEND_URL, and seeds
 *                        default hours (deploy/demo.mjs) for restaurants
 *                        created through the proxy while it runs.
 *
 * Children are spawned with an IPC channel. They shut the service down when
 * that channel disconnects (the parent died) or on SIGTERM, so killing the
 * supervisor on any platform — including Windows, where SIGTERM terminates
 * without running handlers — tears down the whole tree and releases the ports.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 3000);
const BACKEND_HOST = process.env.BACKEND_HOST ?? '127.0.0.1';
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT ?? 8080);
const FRONTEND_HOST = process.env.FRONTEND_HOST ?? '127.0.0.1';
const DATABASE_PATH = process.env.DATABASE_PATH ?? join(STAGE_ROOT, 'tablekeeper.db');

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/* ------------------------------------------------------------------ *
 * Children
 * ------------------------------------------------------------------ */

async function runBackend() {
  const { openDatabase, closeDatabase } = await import('../../stage-1/src/db.ts');
  const { migrate2 } = await import('../../stage-2/src/hours.ts');
  const { createStage2RequestListener } = await import('../../stage-2/src/availability.ts');

  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
  const db = openDatabase(DATABASE_PATH);
  migrate2(db);

  const server = createServer(createStage2RequestListener(db));
  server.on('error', (err) => {
    console.error(`[backend] failed to start: ${err.message}`);
    process.exit(1);
  });
  server.listen(BACKEND_PORT, BACKEND_HOST, () => {
    log(`[backend] listening on http://${BACKEND_HOST}:${BACKEND_PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      try {
        closeDatabase(db);
      } catch {
        // Already closed.
      }
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('disconnect', shutdown);
}

async function runFrontend() {
  const { startServer } = await import('../frontend/serve.mjs');
  const { seedDefaultHours } = await import('./demo.mjs');
  const backendUrl =
    process.env.BACKEND_URL ?? `http://${BACKEND_HOST}:${BACKEND_PORT}`;
  const server = await startServer(join(STAGE_ROOT, 'frontend'), {
    port: FRONTEND_PORT,
    host: FRONTEND_HOST,
    backendUrl,
    // R3: the composition layer prepares default hours for restaurants
    // created through this proxy. serve.mjs itself has no SQL; standalone
    // runs without this hook do no fixture preparation.
    onRestaurantCreated: (id) => seedDefaultHours(id, DATABASE_PATH),
  });
  log(`[frontend] listening on http://${FRONTEND_HOST}:${FRONTEND_PORT} proxying ${backendUrl}`);

  const shutdown = () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(0),
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('disconnect', shutdown);
}

/* ------------------------------------------------------------------ *
 * Supervisor
 * ------------------------------------------------------------------ */

const THIS_FILE = fileURLToPath(import.meta.url);

function spawnChild(role, extraEnv) {
  const child = spawn(process.execPath, [THIS_FILE, `--${role}`], {
    cwd: STAGE_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('exit', (code, signal) => {
    if (code === 0) {
      log(`[supervisor] ${role} child exited cleanly`);
    } else {
      log(`[supervisor] ${role} child exited with code ${code ?? signal}`);
    }
  });
  return child;
}

function waitForReady(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out waiting for ${url}`));
        return;
      }
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Not up yet.
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

async function main() {
  if (process.argv.includes('--backend')) {
    await runBackend();
    return;
  }
  if (process.argv.includes('--frontend')) {
    await runFrontend();
    return;
  }

  log(
    `TableKeeper supervisor — frontend http://${FRONTEND_HOST}:${FRONTEND_PORT}, ` +
      `backend http://${BACKEND_HOST}:${BACKEND_PORT}, db ${DATABASE_PATH}`,
  );

  const children = [
    spawnChild('backend', { BACKEND_PORT, BACKEND_HOST, DATABASE_PATH }),
    spawnChild('frontend', {
      FRONTEND_PORT,
      FRONTEND_HOST,
      BACKEND_HOST,
      BACKEND_URL: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
      DATABASE_PATH,
    }),
  ];

  let shuttingDown = false;
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[supervisor] shutting down (exit ${exitCode})`);
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
    }
    // The children close their own ports; give them a moment, then go.
    setTimeout(() => process.exit(exitCode), 1000);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  let exited = false;
  for (const child of children) {
    child.on('exit', (code) => {
      if (!exited && !shuttingDown && code !== 0) {
        exited = true;
        shutdown(1);
      }
    });
  }

  try {
    // The frontend may be bound to all interfaces; probe it on loopback.
    const readyHost = FRONTEND_HOST === '0.0.0.0' || FRONTEND_HOST === '::' ? '127.0.0.1' : FRONTEND_HOST;
    await waitForReady(`http://${readyHost}:${FRONTEND_PORT}/health`, 30000);
    if (!shuttingDown) {
      log('TableKeeper ready — frontend is serving and the backend is healthy.');
    }
  } catch (err) {
    console.error(`[supervisor] ${err.message}`);
    shutdown(1);
  }

  // Keep the supervisor alive; children and signals drive the lifecycle.
  await new Promise(() => {});
}

await main();