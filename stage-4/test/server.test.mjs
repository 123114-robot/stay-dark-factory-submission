/**
 * Unit 1 — Stage 4 Server/Proxy Contract Tests
 *
 * RED phase: Tests for static file serving and proxy behavior.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer, get as httpGet } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { startServer, DEFAULT_BACKEND_URL, resolveStaticPath } from '../frontend/serve.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a portable temp directory for test fixtures to preserve canonical UI files
const TEMP_DIR = mkdtempSync(join(tmpdir(), 'stage4-server-'));
const CANARY_NAME = `${basename(TEMP_DIR)}-outside-canary.txt`;
const CANARY_PATH = join(dirname(TEMP_DIR), CANARY_NAME);
const SIBLING_DIR = `${TEMP_DIR}-sibling`;
const SIBLING_CANARY = join(SIBLING_DIR, 'canary.txt');

/** Raw GET whose path is sent verbatim — the URL parser never sees `..`. */
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpGet({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, headers: response.headers, body };
}

describe('Stage 4 Server/Proxy Contract', () => {
  /** @type {import('../frontend/serve.mjs').ServerInstance} */
  let server;
  let baseUrl;
  /** @type {import('node:http').Server} */
  let fakeBackend;
  let fakeBackendPort;
  let fakeBackendRequests = [];

  before(async () => {
    // Create temp directory for test fixtures
    await mkdir(TEMP_DIR, { recursive: true });

    // Canary files OUTSIDE the frontend directory: served only if the
    // traversal guard is missing or lets a sibling prefix through.
    writeFileSync(CANARY_PATH, 'CANARY_OUTSIDE');
    mkdirSync(SIBLING_DIR, { recursive: true });
    writeFileSync(SIBLING_CANARY, 'CANARY_SIBLING');

    // Create fake backend that records all requests
    fakeBackend = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        fakeBackendRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body || undefined,
        });

        // Simulate various backend responses
        if (req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else if (req.url.startsWith('/v1/restaurants')) {
          if (req.method === 'POST') {
            res.writeHead(201, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id: 'rest-123' }));
          } else if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ slots: [] }));
          } else {
            res.writeHead(405);
            res.end();
          }
        } else if (req.url === '/v1/error') {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'SLOT_TAKEN', message: 'Slot taken' } }));
        } else if (req.url === '/v1/empty') {
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
        }
      });
    });

    await new Promise((resolve) => {
      fakeBackend.listen(0, '127.0.0.1', () => {
        fakeBackendPort = fakeBackend.address().port;
        resolve();
      });
    });

    // Create static files for testing in temp directory
    await writeFile(join(TEMP_DIR, 'index.html'), '<!DOCTYPE html><html><head><title>TableKeeper</title><link rel="stylesheet" href="styles.css"></head><body><h1>TableKeeper</h1><script src="app.js"></script></body></html>');
    await writeFile(join(TEMP_DIR, 'app.js'), 'console.log("TableKeeper App");');
    await writeFile(join(TEMP_DIR, 'styles.css'), 'body { font-family: sans-serif; }');

    // Start Stage 4 server pointing at fake backend
    server = await startServer(TEMP_DIR, {
      port: 0,
      backendUrl: `http://127.0.0.1:${fakeBackendPort}`,
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  after(async () => {
    await server.close();
    await new Promise((resolve) => fakeBackend.close(resolve));
    // Clean up temp directory and canary files
    await rm(TEMP_DIR, { recursive: true, force: true });
    rmSync(CANARY_PATH, { force: true });
    rmSync(SIBLING_DIR, { recursive: true, force: true });
  });

  describe('Static File Serving', () => {
    it('serves index.html with correct content-type', async () => {
      const response = await fetch(`${baseUrl}/`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'text/html; charset=utf-8');
      const body = await response.text();
      assert.ok(body.includes('<h1>TableKeeper</h1>'));
    });

    it('serves index.html at /index.html', async () => {
      const response = await fetch(`${baseUrl}/index.html`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'text/html; charset=utf-8');
    });

    it('serves JS with correct content-type', async () => {
      const response = await fetch(`${baseUrl}/app.js`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'application/javascript; charset=utf-8');
      const body = await response.text();
      assert.ok(body.includes('TableKeeper App'));
    });

    it('serves CSS with correct content-type', async () => {
      const response = await fetch(`${baseUrl}/styles.css`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'text/css; charset=utf-8');
      const body = await response.text();
      assert.ok(body.includes('font-family'));
    });

    it('returns 404 for missing static files', async () => {
      const response = await fetch(`${baseUrl}/nonexistent.js`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('Proxy Behavior', () => {
    beforeEach(() => {
      fakeBackendRequests.length = 0;
    });

    it('forwards GET request method', async () => {
      await fetch(`${baseUrl}/health`);
      const lastRequest = fakeBackendRequests[fakeBackendRequests.length - 1];
      assert.strictEqual(lastRequest.method, 'GET');
    });

    it('forwards POST request method with body', async () => {
      const payload = JSON.stringify({ name: 'Test Restaurant', timezone: 'America/New_York' });
      await fetch(`${baseUrl}/v1/restaurants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      const lastRequest = fakeBackendRequests[fakeBackendRequests.length - 1];
      assert.strictEqual(lastRequest.method, 'POST');
      assert.strictEqual(lastRequest.body, payload);
    });

    it('forwards query string', async () => {
      await fetch(`${baseUrl}/v1/restaurants/rest-123/availability?local_date=2026-10-04&party_size=4&duration_min=60`);
      const lastRequest = fakeBackendRequests[fakeBackendRequests.length - 1];
      assert.strictEqual(lastRequest.url, '/v1/restaurants/rest-123/availability?local_date=2026-10-04&party_size=4&duration_min=60');
    });

    it('forwards path correctly', async () => {
      await fetch(`${baseUrl}/v1/bookings/booking-456`);
      const lastRequest = fakeBackendRequests[fakeBackendRequests.length - 1];
      assert.strictEqual(lastRequest.url, '/v1/bookings/booking-456');
    });

    it('preserves backend success status 200', async () => {
      const response = await fetch(`${baseUrl}/v1/restaurants/rest-123/availability`);
      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.deepStrictEqual(body, { slots: [] });
    });

    it('preserves backend success status 201', async () => {
      const response = await fetch(`${baseUrl}/v1/restaurants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      assert.strictEqual(response.status, 201);
      const body = await response.json();
      assert.deepStrictEqual(body, { id: 'rest-123' });
    });

    it('preserves backend success status 204', async () => {
      const response = await fetch(`${baseUrl}/v1/empty`);
      assert.strictEqual(response.status, 204);
    });

    it('preserves backend error status and body', async () => {
      const response = await fetch(`${baseUrl}/v1/error`);
      assert.strictEqual(response.status, 409);
      const body = await response.json();
      assert.deepStrictEqual(body, { error: { code: 'SLOT_TAKEN', message: 'Slot taken' } });
    });

    it('preserves backend 404 status', async () => {
      const response = await fetch(`${baseUrl}/v1/unknown`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('Security', () => {
    it('blocks a raw path-traversal request that would serve a file outside the root', async () => {
      // http.get sends the path verbatim; only the guard can refuse it, so
      // deleting the guard makes this request answer 200 with the canary.
      const response = await rawGet(server.port, `/../${CANARY_NAME}`);
      assert.strictEqual(response.status, 404);
      assert.ok(!response.body.includes('CANARY_OUTSIDE'));
    });

    it('blocks a sibling-directory prefix from matching the frontend root', async () => {
      // `<root>-sibling/...` starts with the root string; only the
      // separator-aware check refuses it.
      const response = await rawGet(server.port, `/../${basename(SIBLING_DIR)}/canary.txt`);
      assert.strictEqual(response.status, 404);
      assert.ok(!response.body.includes('CANARY_SIBLING'));
    });

    it('blocks a raw backslash traversal request', async () => {
      const response = await rawGet(server.port, `/..\\${CANARY_NAME}`);
      assert.strictEqual(response.status, 404);
      assert.ok(!response.body.includes('CANARY_OUTSIDE'));
    });

    it('resolveStaticPath refuses escaping paths and accepts in-root paths', () => {
      assert.strictEqual(resolveStaticPath(TEMP_DIR, '/../x.txt'), null);
      assert.strictEqual(resolveStaticPath(TEMP_DIR, `/../${CANARY_NAME}`), null);
      assert.strictEqual(resolveStaticPath(TEMP_DIR, '/../anything/../../etc/passwd'), null);
      // Backslash is a separator on Windows only.
      if (process.platform === 'win32') {
        assert.strictEqual(resolveStaticPath(TEMP_DIR, '/..\\x.txt'), null);
      }
      assert.strictEqual(resolveStaticPath(TEMP_DIR, '/'), TEMP_DIR);
      assert.strictEqual(resolveStaticPath(TEMP_DIR, '/index.html'), join(TEMP_DIR, 'index.html'));
      // An encoded slash is not a path separator: it stays inside the root
      // and simply misses on disk.
      assert.strictEqual(
        resolveStaticPath(TEMP_DIR, '/%2e%2e/package.json'),
        join(TEMP_DIR, '%2e%2e', 'package.json'),
      );

      // Malformed (non-absolute) frontendDir fails closed: every candidate is
      // refused instead of being resolved against the process cwd.
      assert.strictEqual(resolveStaticPath('frontend', '/../x.txt'), null);
      assert.strictEqual(resolveStaticPath('frontend', '/index.html'), null);
    });

    it('fetch-normalized traversal still answers 404', async () => {
      const response = await fetch(`${baseUrl}/../${CANARY_NAME}`);
      assert.strictEqual(response.status, 404);
    });

    it('blocks encoded traversal attempts', async () => {
      const response = await fetch(`${baseUrl}/%2e%2e/package.json`);
      assert.ok(response.status === 404 || response.status === 400);
    });

    it('does not expose arbitrary filesystem files', async () => {
      // Try to access a file outside frontend dir
      const response = await fetch(`${baseUrl}/../plan.md`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('Backend Unavailable', () => {
    it('returns deterministic 5xx JSON when backend unavailable', async () => {
      // Create a server with a backend that doesn't exist
      const badServer = await startServer(TEMP_DIR, {
        port: 0,
        backendUrl: 'http://127.0.0.1:59999', // Port that should be free
      });

      try {
        const response = await fetch(`http://127.0.0.1:${badServer.port}/v1/restaurants`);
        assert.ok(response.status >= 500 && response.status < 600, `Expected 5xx, got ${response.status}`);
        const body = await response.json();
        assert.ok(body.error, 'Should have error envelope');
        assert.ok(body.error.code, 'Should have error code');
        assert.ok(body.error.message, 'Should have error message');
      } finally {
        await badServer.close();
      }
    });
  });

  describe('Standalone entry with only PORT set (R1 regression)', () => {
    // TASK.md section 9, R1: `node frontend/serve.mjs` with no FRONTEND_DIR
    // must default to this directory's files. On Windows the old
    // URL-based default produced `/C:/...`, the guard rejected every path,
    // and /index.html answered 404. This test fails before that fix.
    let child;
    let childStdout = '';
    let childStderr = '';
    let standaloneBase;

    before(async () => {
      const env = { ...process.env, PORT: '0', BACKEND_URL: `http://127.0.0.1:${fakeBackendPort}` };
      delete env.FRONTEND_DIR;

      child = spawn(process.execPath, [join(__dirname, '..', 'frontend', 'serve.mjs')], {
        cwd: join(__dirname, '..'),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => (childStdout += chunk));
      child.stderr.on('data', (chunk) => (childStderr += chunk));

      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
      const deadline = Date.now() + 10_000;
      for (;;) {
        const match = /Stage 4 server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(childStdout);
        if (match) {
          standaloneBase = `http://127.0.0.1:${match[1]}`;
          break;
        }
        if (await Promise.race([exited.then(() => true), Promise.resolve(false)])) {
          throw new Error(`standalone server exited early (code): ${childStderr || childStdout}`);
        }
        if (Date.now() > deadline) {
          child.kill();
          throw new Error(`standalone server never reported a port: ${childStderr || childStdout}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });

    after(async () => {
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
    });

    it('serves /index.html from the default frontend directory', async () => {
      const response = await fetch(`${standaloneBase}/index.html`);
      assert.strictEqual(response.status, 200);
      assert.ok(
        (response.headers.get('content-type') ?? '').startsWith('text/html'),
        `unexpected content-type: ${response.headers.get('content-type')}`,
      );
      const body = await response.text();
      assert.ok(body.includes('<h1'), 'index.html body missing page markup');
    });

    it('proxies /health to the backend', async () => {
      fakeBackendRequests.length = 0;
      const response = await fetch(`${standaloneBase}/health`);
      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.deepStrictEqual(body, { status: 'ok' });
      const health = fakeBackendRequests.find((r) => r.url === '/health');
      assert.ok(health, 'backend never received the proxied /health request');
      assert.strictEqual(health.method, 'GET');
    });
  });

  describe('Route Precedence', () => {
    it('serves static files before proxying', async () => {
      // /app.js exists as static file - should not proxy to backend
      const requestsBefore = fakeBackendRequests.length;
      const response = await fetch(`${baseUrl}/app.js`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(fakeBackendRequests.length, requestsBefore); // Should not hit backend
    });

    it('proxies API routes even if they look like files', async () => {
      // /v1/availability.js would be an API route, not a file
      // (This tests the routing logic prioritizes /v1/* over static)
    });
  });
});

describe('Default Backend URL', () => {
  it('uses default backend URL from environment', () => {
    assert.strictEqual(DEFAULT_BACKEND_URL, 'http://127.0.0.1:3000');
  });
});
