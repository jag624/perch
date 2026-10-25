import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { createServer } from '../src/server.js';
import { createDemoSource } from '../src/sources/demo.js';

// The HTTP tests need to bind a localhost socket. A read-only review sandbox may
// forbid that outright, so probe once at load and register those tests as a stated
// SKIP rather than letting a wall of EPERM read like a broken packet.
async function canBindLocalhost() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

// PERCH_TEST_FORCE_NO_SOCKET=1 forces the sandbox condition locally, so the skip
// path is proven to fire rather than merely written.
const SOCKET_OK =
  process.env.PERCH_TEST_FORCE_NO_SOCKET === '1' ? false : await canBindLocalhost();
const socketTest = (name, fn) =>
  test(name, { skip: SOCKET_OK ? false : 'sandbox forbids binding a localhost socket' }, fn);

test('demo source: the fixture room exercises every tier the classifier can produce', () => {
  const source = createDemoSource({ queueLimit: 500 });
  const tiers = new Set(source.live().queue.map((entry) => entry.tier));

  for (const tier of ['returning_whale', 'whale', 'prospect', 'regular', 'lapsed', 'new_face', 'window_shopper', 'anonymous']) {
    assert.ok(tiers.has(tier), `the demo must be able to show a "${tier}"`);
  }

  const feed = source.live();
  assert.ok(feed.room.present > 20, 'the fixture room should look like a busy room');
  assert.ok(feed.room.anonymous > 0, 'anonymous viewers are the bulk of a real room and must be modelled');
});

test('demo source: every queue entry carries a reason and a non-negative score', () => {
  const source = createDemoSource({ queueLimit: 500 });
  for (const entry of source.live().queue) {
    assert.ok(Array.isArray(entry.reasons) && entry.reasons.length > 0, `${entry.username} has no reasons`);
    assert.ok(entry.score >= 0);
  }
});

socketTest('server: exposes health, the live queue, the dashboard, and per-viewer detail', async (t) => {
  const runner = createServer({ pollMs: 0 });
  const { url } = await runner.start(0);
  t.after(() => runner.stop());

  const health = await (await fetch(`${url}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'demo');

  const live = await (await fetch(`${url}/api/live`)).json();
  assert.ok(Array.isArray(live.queue) && live.queue.length > 0);
  assert.equal(live.queue[0].rank, 1);
  assert.ok(live.queue[0].reasons.length > 0, 'every queue entry must explain itself');
  assert.ok(live.room.present >= live.queue.length);
  assert.equal(typeof live.room.tokensToday, 'number');

  const html = await (await fetch(`${url}/`)).text();
  assert.match(html, /Attention queue/);

  const target = live.queue[0].username;
  const viewer = await (await fetch(`${url}/api/viewer?name=${encodeURIComponent(target)}`)).json();
  assert.equal(viewer.username, target);
  assert.ok(viewer.classification.reasons.length > 0, 'the detail panel needs the same explanation');
});

socketTest('server: rejects bad input instead of returning a confusing empty payload', async (t) => {
  const runner = createServer({ pollMs: 0 });
  const { url } = await runner.start(0);
  t.after(() => runner.stop());

  assert.equal((await fetch(`${url}/api/viewer`)).status, 400);
  assert.equal((await fetch(`${url}/api/viewer?name=nobody-here`)).status, 404);
  assert.equal((await fetch(`${url}/nope`)).status, 404);
  assert.equal((await fetch(`${url}/api/tick`)).status, 404, 'tick is POST-only');
});

socketTest('server: POST /api/tick advances the room and reports the churn', async (t) => {
  const runner = createServer({ pollMs: 0 });
  const { url } = await runner.start(0);
  t.after(() => runner.stop());

  const before = await (await fetch(`${url}/api/live`)).json();
  const first = await (await fetch(`${url}/api/tick`, { method: 'POST' })).json();
  await fetch(`${url}/api/tick`, { method: 'POST' });
  const after = await (await fetch(`${url}/api/live`)).json();

  assert.ok('arrivals' in first && 'departures' in first);
  assert.equal(after.polls, before.polls + 2, 'each tick is a poll of the room feed');
  assert.ok(first.departures.length > 0, 'a ticking room should show someone leaving');
});
