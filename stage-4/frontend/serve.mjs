/**
 * Stage 4 Static Server and Proxy
 *
 * Serves static files from the frontend directory and proxies API requests
 * to the backend service.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';

/**
 * Resolve a raw request path (query/fragment stripped, NOT URL-normalized)
 * against the frontend directory, refusing anything that escapes it.
 *
 * The guard runs on the raw path so `..` segments reach it: the WHATWG URL
 * parser would otherwise collapse them before the check and the guard could
 * never fire. Returns the absolute file path, or null when the request tries
 * to leave the frontend directory (including sibling-prefix tricks such as
 * `frontend-secret/` next to `frontend/`).
 */
export function resolveStaticPath(frontendDir, rawPath) {
  const candidate = resolve(join(frontendDir, rawPath));
  const root = frontendDir.endsWith(sep) ? frontendDir : frontendDir + sep;
  if (candidate !== frontendDir && !candidate.startsWith(root)) {
    return null;
  }
  return candidate;
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * @typedef {Object} ServerOptions
 * @property {number} [port=8080]
 * @property {string} [host='127.0.0.1']
 * @property {string} [backendUrl]
 * @property {(id: string) => Promise<void>} [onRestaurantCreated]
 *   Optional composition-layer hook (TASK.md section 9, R3): awaited after a
 *   buffered 201 from proxied `POST /v1/restaurants`, before the backend's
 *   response is forwarded unchanged. This file contains no SQL and no
 *   database imports; fixture preparation lives in deploy/demo.mjs. Absent
 *   hook (standalone run) means no fixture preparation.
 */

/**
 * @typedef {Object} ServerInstance
 * @property {import('node:http').Server} server
 * @property {number} port
 * @property {() => Promise<void>} close
 */

/**
 * Start the Stage 4 static server and proxy.
 *
 * @param {string} frontendDir - Directory containing static files
 * @param {ServerOptions} options
 * @returns {Promise<ServerInstance>}
 */
export async function startServer(frontendDir, options = {}) {
  const port = options.port ?? 8080;
  const host = options.host ?? '127.0.0.1';
  const backendUrl = options.backendUrl ?? DEFAULT_BACKEND_URL;
  const onRestaurantCreated = options.onRestaurantCreated;
  const root = resolve(frontendDir);

  const server = createServer(async (req, res) => {
    // Raw target: query/fragment stripped, no dot-segment normalization.
    const rawPath = (req.url ?? '/').split(/[?#]/)[0] || '/';

    // Block path traversal attempts before anything normalizes them away.
    const resolvedPath = resolveStaticPath(root, rawPath);
    if (resolvedPath === null) {
      sendError(res, 404, 'NOT_FOUND', 'Not found');
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendError(res, 400, 'BAD_REQUEST', 'Invalid URL');
      return;
    }

    // API routes go to backend
    if (pathname.startsWith('/v1/') || pathname === '/health') {
      await proxyToBackend(backendUrl, req, res, pathname, onRestaurantCreated);
      return;
    }

    // Static file serving: the root itself serves index.html.
    const filePath = resolvedPath === root ? join(root, 'index.html') : resolvedPath;
    await serveStatic(filePath, res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' ? address.port : port,
        close: () => new Promise((done, fail) => {
          server.close((err) => {
            if (err) fail(err);
            else done();
          });
          server.closeAllConnections();
        }),
      });
    });
  });
}

/**
 * Serve a static file given its already-resolved absolute path.
 *
 * @param {string} filePath
 * @param {import('node:http').ServerResponse} res
 */
async function serveStatic(filePath, res) {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

    res.writeHead(200, {
      'content-type': `${mimeType}; charset=utf-8`,
      'content-length': content.length,
    });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendError(res, 404, 'NOT_FOUND', 'Not found');
    } else {
      sendError(res, 500, 'INTERNAL', 'Internal server error');
    }
  }
}

/**
 * Proxy a request to the backend.
 *
 * @param {string} backendUrl
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @param {(id: string) => Promise<void>} [onRestaurantCreated]
 */
async function proxyToBackend(backendUrl, req, res, pathname, onRestaurantCreated) {
  const method = req.method ?? 'GET';

  // Collect request body for proxied requests with body
  let body = Buffer.alloc(0);
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    body = await collectBody(req);
  }

  const targetUrl = `${backendUrl}${pathname}${req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

  try {
    const fetchOptions = {
      method,
      headers: {
        'content-type': req.headers['content-type'] ?? 'application/json',
      },
    };

    if (body.length > 0) {
      fetchOptions.body = body;
    }

    const backendRes = await fetch(targetUrl, fetchOptions);
    const backendBody = await backendRes.text();

    // R3 composition hook: run after the response is buffered, before it is
    // forwarded. Failures are logged; the backend's 201 is still forwarded.
    if (
      typeof onRestaurantCreated === 'function' &&
      method === 'POST' &&
      pathname === '/v1/restaurants' &&
      backendRes.status === 201
    ) {
      try {
        const created = JSON.parse(backendBody);
        if (typeof created?.id === 'string' && created.id !== '') {
          await onRestaurantCreated(created.id);
        }
      } catch (err) {
        console.error(`[frontend] onRestaurantCreated hook failed: ${err?.message ?? err}`);
      }
    }

    // Forward response headers and body
    res.writeHead(backendRes.status, {
      'content-type': backendRes.headers.get('content-type') ?? 'application/json',
    });
    res.end(backendBody);
  } catch (err) {
    // Backend unavailable - return deterministic 5xx JSON error
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Backend service unavailable');
  }
}

/**
 * Collect the request body into a buffer.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Send a JSON error response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function sendError(res, status, code, message) {
  const body = JSON.stringify({ error: { code, message } });
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Main entry point when running directly.
 */
async function main() {
  const frontendDir = process.env.FRONTEND_DIR ?? fileURLToPath(new URL('.', import.meta.url));
  const port = Number(process.env.PORT ?? 8080);
  const backendUrl = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;

  const server = await startServer(frontendDir, { port, backendUrl });
  console.log(`Stage 4 server listening on http://127.0.0.1:${server.port}`);
  console.log(`Proxying API to ${backendUrl}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()
) {
  await main();
}
