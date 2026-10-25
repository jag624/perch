import test from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../src/core/rate-limiter.js';
import { chunk, batchCost, BATCH_LIMIT } from '../src/core/batch.js';
import { normalizeViewer, parseRoomFeed, spendElsewhere } from '../src/core/room-feed.js';
import { RoomTracker } from '../src/core/arrivals.js';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('rate limiter: allows a full burst then refuses', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, now: c.now });
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.tryAcquire(), true, `burst #${i + 1}`);
  assert.equal(limiter.tryAcquire(), false, 'sixth call in the same instant must be refused');
});

test('rate limiter: refills over time', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, now: c.now });
  for (let i = 0; i < 5; i += 1) limiter.tryAcquire();
  c.advance(12_500); // 5/min == one slot per 12s
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), false);
});

test('rate limiter: msUntil reports roughly one slot, and zero when a slot is free', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, now: c.now });
  assert.equal(limiter.msUntil(1), 0, 'a fresh limiter has slots available');
  for (let i = 0; i < 5; i += 1) limiter.tryAcquire();
  const wait = limiter.msUntil(1);
  assert.ok(wait >= 11_950 && wait <= 12_050, `expected ~12000ms, got ${wait}`);
});

test('rate limiter: a 429 penalty blocks the bucket even when tokens are free', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, now: c.now });
  limiter.penalize(30_000);
  assert.equal(limiter.tryAcquire(), false, 'penalty outranks an available token');
  assert.ok(limiter.msUntil(1) >= 30_000);
  c.advance(30_001);
  assert.equal(limiter.tryAcquire(), true);
});

test('rate limiter: acquire waits for a slot instead of dropping the request', async () => {
  const c = clock();
  const sleeps = [];
  const limiter = new RateLimiter({
    limit: 1,
    windowMs: 1_000,
    now: c.now,
    sleep: async (ms) => { sleeps.push(ms); c.advance(ms); },
  });
  await limiter.acquire();
  await limiter.acquire();
  assert.equal(sleeps.length, 1, 'the second acquisition had to wait exactly once');
  assert.ok(sleeps[0] >= 990 && sleeps[0] <= 1_010, `expected ~1000ms, got ${sleeps[0]}`);
});

test('rate limiter: rejects a nonsensical limit', () => {
  assert.throws(() => new RateLimiter({ limit: 0 }), /positive number/);
});

test('batch: chunks to the 100-name cap and costs one request per chunk', () => {
  const names = Array.from({ length: 250 }, (_, i) => `u${i}`);
  const groups = chunk(names, BATCH_LIMIT);
  assert.deepEqual(groups.map((g) => g.length), [100, 100, 50]);
  assert.equal(batchCost(250), 3);
  assert.equal(batchCost(100), 1);
  assert.equal(batchCost(0), 0);
  assert.deepEqual(chunk([], 100), []);
  assert.throws(() => chunk(names, 0), /positive integer/);
});

test('room feed: coerces messy numbers and flags viewers who cannot tip', () => {
  const anon = normalizeViewer({ username: '', userType: 'anonymous' });
  assert.equal(anon.isAnonymous, true);

  const noName = normalizeViewer({ userType: 'user' });
  assert.equal(noName.isAnonymous, true, 'no username means no account');

  const viewer = normalizeViewer({
    username: 'spender',
    color: 'PURPLE',
    userType: 'user',
    tipsWeek: '1500',
    allTimeTokens: 9000,
    tipsAllRooms: 40000,
    tipsThirtyDays: null,
  });
  assert.equal(viewer.isAnonymous, false);
  assert.equal(viewer.color, 'purple');
  assert.equal(viewer.tokens.room.week, 1500);
  assert.equal(viewer.tokens.room.thirtyDays, 0, 'null coerces to 0, not NaN');
  assert.equal(viewer.tokens.allRooms.allTime, 40000);
  assert.equal(spendElsewhere(viewer), 31000);
});

test('room feed: parses a payload and preserves the server-defined columns', () => {
  const feed = parseRoomFeed({
    users: [{ username: 'a', userType: 'user' }, { username: '', userType: 'anon' }],
    tipsColumns: [{ key: 'tipsWeek', header: 'Week', sortable: true }],
    pagination: { total: 2, page: 1 },
    cached_at: '2026-10-25T12:00:00Z',
  });
  assert.equal(feed.users.length, 2);
  assert.equal(feed.users[1].isAnonymous, true);
  assert.equal(feed.columns.length, 1);
  assert.equal(feed.total, 2);
  assert.equal(feed.cachedAt, '2026-10-25T12:00:00Z');
});

test('arrivals: reports arrivals once, then departures with dwell time', () => {
  const c = clock(1_000);
  const tracker = new RoomTracker({ now: c.now });

  let result = tracker.update([{ username: 'a' }, { username: 'b' }]);
  assert.deepEqual(result.arrivals.map((v) => v.username), ['a', 'b']);
  assert.equal(result.presentCount, 2);

  c.advance(4_000);
  result = tracker.update([{ username: 'a' }, { username: 'b' }]);
  assert.equal(result.arrivals.length, 0, 'an unchanged room produces no arrivals');
  assert.equal(result.departures.length, 0);

  c.advance(4_000);
  result = tracker.update([{ username: 'b' }, { username: 'c' }]);
  assert.deepEqual(result.arrivals.map((v) => v.username), ['c']);
  assert.deepEqual(result.departures.map((v) => v.username), ['a']);
  assert.equal(result.departures[0].dwellMs, 8_000, 'a left 8s after arriving');
});

test('arrivals: dwell() reports how long each viewer has been present', () => {
  const c = clock(0);
  const tracker = new RoomTracker({ now: c.now });
  tracker.update([{ username: 'a' }]);
  c.advance(3_000);
  tracker.update([{ username: 'a' }, { username: 'b' }]);
  const dwell = tracker.dwell();
  assert.equal(dwell.find((d) => d.username === 'a').dwellMs, 3_000);
  assert.equal(dwell.find((d) => d.username === 'b').dwellMs, 0);
});
