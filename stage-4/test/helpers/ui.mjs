/**
 * Shared harness for the Units 3-7 UI tests.
 *
 * Boots the REAL composed backend (stage 1 routes + stage 2 availability) on
 * an ephemeral port with a disposable SQLite file, then loads the canonical
 * index.html + app.js into jsdom pointed at that server. Every test therefore
 * exercises the actual product code with no fixture writes into frontend/.
 */

import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(here, '..', '..');
export const FRONTEND_DIR = join(ROOT_DIR, 'frontend');

/**
 * Start the composed backend (stage 1 + stage 2 listener) on an ephemeral port.
 * Returns the port, the open Db handle (for direct fixture seeding), the db path
 * and a close() that tears everything down and removes the disposable files.
 */
export async function startRealBackend() {
  const { openDatabase } = await import('../../../stage-1/src/db.ts');
  const { createStage2RequestListener } = await import('../../../stage-2/src/availability.ts');
  const { migrate2 } = await import('../../../stage-2/src/hours.ts');

  const dbPath = join(tmpdir(), `tablekeeper-ui-${randomUUID()}.db`);
  const db = openDatabase(dbPath);
  migrate2(db);

  const server = createServer(createStage2RequestListener(db));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    dbPath,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      await rm(dbPath, { force: true });
      await rm(`${dbPath}-wal`, { force: true });
      await rm(`${dbPath}-shm`, { force: true });
    },
  };
}

/**
 * Give a restaurant service hours for every weekday so availability searches
 * return real slots. Stages 1-2 expose no hours API (frozen scope), so tests
 * seed the disposable database directly, exactly as stage 2's own tests do.
 */
export function seedHours(db, restaurantId, opensMin = 6 * 60, closesMin = 23 * 60) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO restaurant_hours (restaurant_id, weekday, opens_min, closes_min) VALUES (?, ?, ?, ?)',
  );
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    stmt.run(restaurantId, weekday, opensMin, closesMin);
  }
}

/**
 * A minimal stand-in backend for states the real backend cannot be forced
 * into on demand (malformed bodies, forced failures, error envelopes).
 * routes: [{ match: (req) => bool, status, body, raw, delayMs }]
 */
export async function startStubBackend(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      const route = routes.find((candidate) => candidate.match(req));
      const send = () => {
        if (!route) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'stub: no route' } }));
          return;
        }
        if (route.status === undefined) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(route.status, { 'content-type': route.contentType ?? 'application/json' });
        res.end(route.raw ?? JSON.stringify(route.body));
      };
      if (route?.delayMs) setTimeout(send, route.delayMs);
      else send();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Load the canonical index.html + app.js into jsdom against `baseUrl`.
 *
 * Returns { window, document, fetchLog, close } where fetchLog records every
 * request the UI issued as { method, url, body } in order, which is what the
 * tests assert ordering and exact payloads against.
 */
export async function createUi(baseUrl) {
  const html = await readFile(join(FRONTEND_DIR, 'index.html'), 'utf8');
  const appSource = await readFile(join(FRONTEND_DIR, 'app.js'), 'utf8');

  const dom = new JSDOM(html, {
    url: `${baseUrl}/`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;

  const fetchLog = [];
  const realFetch = (...args) => globalThis.fetch(...args);
  win.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? new URL(input, baseUrl) : new URL(input.url ?? input);
    let body = init.body;
    if (body !== undefined && typeof body !== 'string') body = String(body);
    const response = await realFetch(url, init);
    fetchLog.push({
      method: init.method ?? 'GET',
      url: url.pathname + url.search,
      body,
      status: response.status,
    });
    return response;
  };

  if (typeof win.crypto?.randomUUID !== 'function') {
    Object.defineProperty(win, 'crypto', {
      value: { randomUUID: () => globalThis.crypto.randomUUID(), getRandomValues: (a) => globalThis.crypto.getRandomValues(a) },
      configurable: true,
    });
  }

  // jsdom has no matchMedia; app.js does not use it, but keep it defined.
  if (typeof win.matchMedia !== 'function') {
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  }

  win.eval(appSource);

  // init() runs on DOMContentLoaded (or immediately if parsing already finished);
  // its first action is marking the connection status as "checking".
  await waitFor(
    () => {
      const status = win.document.getElementById('connection-status');
      return (
        status !== null &&
        (status.classList.contains('checking') ||
          status.classList.contains('connected') ||
          status.classList.contains('unavailable'))
      );
    },
    { label: 'app init (connection status marked)' },
  );
  // Let the initial /health probe settle.
  await tick(win, 30);

  return {
    window: win,
    document: win.document,
    fetchLog,
    close() {
      win.close();
    },
  };
}

export function tick(win, ms = 0) {
  return new Promise((resolve) => {
    const timer = win ? setTimeout(resolve, ms) : setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
  });
}

/**
 * Poll `fn` until it returns a truthy value or the timeout expires.
 */
export async function waitFor(fn, { timeout = 5000, interval = 15, label = 'condition' } = {}) {
  const start = Date.now();
  let lastError;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export function submit(win, form) {
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
}

export function click(win, element) {
  element.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));
}

/**
 * Run the Quick Demo Setup through the UI and return the created ids parsed
 * from the demo result block.
 */
export async function quickDemo(ui) {
  const { window, document } = ui;
  click(window, document.getElementById('quick-demo-btn'));
  const result = await waitFor(
    () => {
      const box = document.getElementById('quick-demo-result');
      const success = box?.querySelector('.message.success');
      const error = box?.querySelector('.message.error');
      if (error) throw new Error(`quick demo failed: ${error.textContent}`);
      if (!success) return null;
      const text = success.textContent;
      const restaurant = /Restaurant:\s*([0-9a-f-]{36})/i.exec(text)?.[1];
      const tables = [...text.matchAll(/Table \d:\s*([0-9a-f-]{36})/gi)].map((m) => m[1]);
      return { restaurant, tables };
    },
    { label: 'quick demo result' },
  );
  return result;
}

/**
 * A tomorrow-ish date that is safely in the future for date inputs.
 */
export function futureDate(offsetDays = 7) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
