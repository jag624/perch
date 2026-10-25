// Minimal stdlib HTTP surface: serves the dashboard and a JSON API.
//
// Deliberately dependency-free so the whole thing runs on this host with no
// install step, and so the same handlers can be ported to a Worker later. In
// demo mode a timer advances the fixture room; against a live account the same
// tick would be a real poll of the room feed.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoSource } from './sources/demo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {{ source?: object, pollMs?: number, now?: () => number }} [opts]
 */
export function createServer({ source, pollMs = 5000, now = () => Date.now() } = {}) {
  const app = source ?? createDemoSource({ now });
  const startedAt = now();
  let timer = null;
  let ticks = 0;

  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    const route = url.pathname;

    try {
      if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
        const html = await readFile(INDEX_PATH);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': html.length,
        });
        return res.end(html);
      }

      if (req.method === 'GET' && route === '/api/health') {
        return sendJson(res, 200, { ok: true, mode: app.mode, uptimeMs: now() - startedAt, ticks, now: now() });
      }

      if (req.method === 'GET' && route === '/api/live') {
        return sendJson(res, 200, app.live());
      }

      if (req.method === 'GET' && route === '/api/viewer') {
        const name = url.searchParams.get('name');
        if (!name) return sendJson(res, 400, { error: 'name query parameter is required' });
        const viewer = app.viewer(name);
        if (!viewer) return sendJson(res, 404, { error: `no such viewer: ${name}` });
        return sendJson(res, 200, viewer);
      }

      if (req.method === 'POST' && route === '/api/tick') {
        const summary = app.tick();
        ticks += 1;
        return sendJson(res, 200, summary);
      }

      return sendJson(res, 404, { error: 'not found', path: route });
    } catch (err) {
      return sendJson(res, 500, { error: err?.message ?? 'internal error' });
    }
  };

  const server = http.createServer(handler);

  return {
    app,
    server,

    async start(port = 0, host = '127.0.0.1') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      if (pollMs > 0) {
        timer = setInterval(() => {
          try {
            app.tick();
            ticks += 1;
          } catch {
            /* a failed tick must never take the server down */
          }
        }, pollMs);
        timer.unref?.();
      }
      const address = server.address();
      return { port: address.port, host, url: `http://${host}:${address.port}` };
    },

    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(argValue('--port') ?? 8787);
  const pollMs = (Number(argValue('--poll') ?? 5) || 5) * 1000;
  const runner = createServer({ pollMs });
  const { url } = await runner.start(port);
  console.log(`perch — ${runner.app.mode} mode — ${url}  (poll ${pollMs / 1000}s)`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      runner.stop().then(() => process.exit(0));
    });
  }
}
