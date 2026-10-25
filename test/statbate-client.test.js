import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStatbateClient,
  createAccountBudget,
  parseRetryAfter,
  AuthError,
  PlanError,
  StatbateError,
} from '../src/sources/statbate.js';

function jsonResponse(body, status = 200, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (key) => headers[String(key).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('retry-after: parses seconds, HTTP dates, and falls back when absent', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(parseRetryAfter('2', { now }), 2000);
  assert.equal(parseRetryAfter('0', { now }), 0);
  assert.equal(parseRetryAfter(new Date(now + 5000).toUTCString(), { now }), 5000);
  assert.equal(parseRetryAfter(null, { now, fallbackMs: 1234 }), 1234);
  assert.equal(parseRetryAfter('nonsense', { now, fallbackMs: 999 }), 999);
});

test('client: sends a bearer token and builds the live-feed URL with an encoded room name', async () => {
  const calls = [];
  const client = createStatbateClient({
    token: 'secret-token',
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return jsonResponse({ users: [] }); },
  });

  await client.roomOnlineUsers({ site: 'chaturbate', roomname: 'your room', page: 2, perPage: 50 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://plus.statbate.com/api/room/chaturbate/your%20room/online-users?page=2&per_page=50');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');
  assert.equal(calls[0].init.method, 'GET');
});

test('client: a 429 waits for Retry-After, penalises the account bucket, then retries', async () => {
  let attempts = 0;
  const sleeps = [];
  const limiter = createAccountBudget({ sleep: async () => {} });
  const client = createStatbateClient({
    token: 't',
    limiter,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '2' }) : jsonResponse({ users: [] });
    },
  });

  const result = await client.roomOnlineUsers({ site: 'chaturbate', roomname: 'x' });
  assert.equal(attempts, 2);
  assert.equal(sleeps[0], 2000, 'the server-specified wait is honoured exactly');
  assert.deepEqual(result, { users: [] });
});

test('client: a persistent 429 gives up instead of hammering a bucket that is closed', async () => {
  let attempts = 0;
  const client = createStatbateClient({
    token: 't',
    maxRetries: 1,
    sleep: async () => {},
    fetchImpl: async () => { attempts += 1; return jsonResponse({}, 429, { 'retry-after': '1' }); },
  });

  await assert.rejects(() => client.roomOnlineUsers({ site: 'chaturbate', roomname: 'x' }), (err) => {
    assert.ok(err instanceof StatbateError);
    assert.equal(err.status, 429);
    return true;
  });
  assert.equal(attempts, 2, 'one initial call plus exactly one retry');
});

test('client: 401 and 403 are distinct, actionable errors', async () => {
  const unauthorized = createStatbateClient({ token: 't', fetchImpl: async () => jsonResponse({}, 401) });
  await assert.rejects(
    () => unauthorized.roomOnlineUsers({ site: 'chaturbate', roomname: 'x' }),
    (err) => {
      assert.ok(err instanceof AuthError, 'a 401 must be the refreshable error');
      return true;
    },
  );

  const forbidden = createStatbateClient({ token: 't', fetchImpl: async () => jsonResponse({}, 403) });
  await assert.rejects(
    () => forbidden.roomOnlineUsers({ site: 'chaturbate', roomname: 'x' }),
    (err) => {
      assert.ok(err instanceof PlanError);
      assert.match(err.message, /upgrade_url/, 'a 403 must tell the caller to send the user to upgrade');
      return true;
    },
  );
});

test('client: a 500 surfaces as a StatbateError carrying the status', async () => {
  const client = createStatbateClient({ token: 't', fetchImpl: async () => jsonResponse({ error: 'boom' }, 500) });
  await assert.rejects(() => client.roomOnlineUsers({ site: 'chaturbate', roomname: 'x' }), (err) => {
    assert.equal(err.status, 500);
    assert.match(err.message, /500/);
    return true;
  });
});

test('client: batch lookups chunk at 100 names and merge, at one request per chunk', async () => {
  const bodySizes = [];
  const client = createStatbateClient({
    token: 't',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      bodySizes.push(body.names.length);
      return jsonResponse({ data: body.names.map((name) => (name.startsWith('bad') ? { name, error: 'not found' } : { name })) });
    },
  });

  const names = Array.from({ length: 250 }, (_, i) => `${i < 3 ? 'bad' + i : 'u' + i}`);
  const result = await client.memberInfoBatch({ site: 'chaturbate', names });

  assert.deepEqual(bodySizes, [100, 100, 50]);
  assert.equal(result.data.length, 250);
  assert.equal(result.meta.requests, 3);
  assert.equal(result.meta.requested, 250);
  assert.equal(result.meta.found, 247, 'rows the API flagged as errors are not counted as found');
  assert.equal(client.limiter, null);
});

test('client: filters junk names out of a batch rather than sending them upstream', async () => {
  let sent = null;
  const client = createStatbateClient({
    token: 't',
    fetchImpl: async (url, init) => { sent = JSON.parse(init.body).names; return jsonResponse({ data: [] }); },
  });
  await client.memberInfoBatch({ site: 'chaturbate', names: ['ok', '', null, undefined, 'fine'] });
  assert.deepEqual(sent, ['ok', 'fine']);
});

test('client: refuses to be constructed without a token', () => {
  assert.throws(() => createStatbateClient({ token: '' }), /token is required/);
});
