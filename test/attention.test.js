import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeViewer } from '../src/core/room-feed.js';
import { buildAttentionQueue, scoreEntry, DEFAULT_ATTENTION } from '../src/core/attention.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString();

const entry = (overrides = {}) => ({
  room: normalizeViewer({ username: 'v', userType: 'user', ...overrides }),
  member: null,
  modelName: 'yourroom',
  arrivedAt: null,
  ...overrides.extra,
});

test('score: value amplifies but does not erase tier weight', () => {
  const cfg = { now: NOW, ...DEFAULT_ATTENTION };
  const noSpend = scoreEntry({ tierWeight: 50, valueTokens: 0, daysSinceLastTip: null, arrivedAt: null }, cfg);
  const bigSpend = scoreEntry({ tierWeight: 50, valueTokens: 100_000, daysSinceLastTip: null, arrivedAt: null }, cfg);
  assert.equal(noSpend.parts.valueFactor, 1, 'a zero-spend viewer keeps a factor of 1');
  assert.ok(bigSpend.score > noSpend.score);
  assert.equal(
    scoreEntry({ tierWeight: 0, valueTokens: 500_000, daysSinceLastTip: null, arrivedAt: null }, cfg).score,
    0,
    'an anonymous viewer scores zero however large the room is',
  );
});

test('score: arriving just now outranks the same viewer who has been sitting there', () => {
  const cfg = { now: NOW, ...DEFAULT_ATTENTION };
  const fresh = scoreEntry({ tierWeight: 50, valueTokens: 5_000, daysSinceLastTip: 3, arrivedAt: NOW - 5_000 }, cfg);
  const settled = scoreEntry({ tierWeight: 50, valueTokens: 5_000, daysSinceLastTip: 3, arrivedAt: NOW - 3_600_000 }, cfg);
  assert.ok(fresh.score > settled.score);
  assert.equal(fresh.parts.novelty, DEFAULT_ATTENTION.noveltyMultiplier);
  assert.equal(settled.parts.novelty, 1);
});

test('score: recent spend beats older spend at the same tier', () => {
  const cfg = { now: NOW, ...DEFAULT_ATTENTION };
  const recent = scoreEntry({ tierWeight: 50, valueTokens: 5_000, daysSinceLastTip: 1, arrivedAt: null }, cfg);
  const stale = scoreEntry({ tierWeight: 50, valueTokens: 5_000, daysSinceLastTip: 80, arrivedAt: null }, cfg);
  assert.ok(recent.score > stale.score);
});

test('queue: ranks by actionability and always explains itself', () => {
  const oldLurker = {
    all_time_tokens: 0,
    last_30_days_tokens: 0,
    last_tip_date: null,
    first_message_date: daysAgo(900),
    models_tipped_2weeks: 0,
    models_tipped_2weeks_list: [],
  };

  const queue = buildAttentionQueue(
    [
      { room: normalizeViewer({ username: 'lurker', userType: 'user' }), member: oldLurker, modelName: 'yourroom', arrivedAt: NOW },
      {
        room: normalizeViewer({ username: 'whale', userType: 'user', allTimeTokens: 80_000, tipsWeek: 9_000 }),
        member: { all_time_tokens: 150_000, last_tip_date: daysAgo(2), models_tipped_2weeks: 2, models_tipped_2weeks_list: [] },
        modelName: 'yourroom',
        arrivedAt: NOW,
      },
      { room: normalizeViewer({ username: '', userType: 'anonymous' }), member: null, modelName: 'yourroom', arrivedAt: NOW },
    ],
    { now: NOW },
  );

  assert.equal(queue[0].username, 'whale');
  assert.equal(queue[0].rank, 1);
  for (const e of queue) {
    assert.ok(e.reasons.length >= 1, `${e.username || '(anonymous)'} has no reasons — a queue entry without reasons is noise`);
  }
  assert.equal(queue[queue.length - 1].username, '', 'anonymous viewers sink to the bottom');
  assert.equal(queue.find((e) => e.username === 'lurker').tier, 'window_shopper');
});

test('queue: an entry with no dossier is marked unknown rather than guessed', () => {
  const queue = buildAttentionQueue(
    [{ room: normalizeViewer({ username: 'stranger', userType: 'user' }), member: null, modelName: 'yourroom', arrivedAt: NOW }],
    { now: NOW },
  );
  assert.equal(queue[0].tier, 'history_unknown');
  assert.match(queue[0].reasons.join(' '), /no dossier returned/);
});

test('queue: honours the limit and numbers the ranks from 1', () => {
  const entries = Array.from({ length: 30 }, (_, i) =>
    entry({ username: `u${i}`, allTimeTokens: 1_000 + i * 3_000, extra: { arrivedAt: NOW } }),
  );
  const queue = buildAttentionQueue(entries, { now: NOW, limit: 5 });
  assert.equal(queue.length, 5);
  assert.deepEqual(queue.map((e) => e.rank), [1, 2, 3, 4, 5]);
});

test('queue: a returning big spender is promoted above a bigger current spender', () => {
  const queue = buildAttentionQueue(
    [
      {
        room: normalizeViewer({ username: 'current', userType: 'user', tipsWeek: 4_000, allTimeTokens: 60_000 }),
        member: { all_time_tokens: 120_000, last_tip_date: new Date(NOW - 1 * 86_400_000).toISOString(), models_tipped_2weeks: 2, models_tipped_2weeks_list: [] },
        modelName: 'yourroom',
        arrivedAt: NOW - 200_000,
      },
      {
        room: normalizeViewer({ username: 'returning', userType: 'user', allTimeTokens: 50_000 }),
        member: { all_time_tokens: 90_000, last_tip_date: new Date(NOW - 90 * 86_400_000).toISOString(), models_tipped_2weeks: 5, models_tipped_2weeks_list: [] },
        modelName: 'yourroom',
        arrivedAt: NOW - 30_000,
      },
    ],
    { now: NOW },
  );
  assert.equal(queue[0].username, 'returning');
  assert.equal(queue[0].tier, 'returning_whale');
  assert.equal(queue[1].tier, 'whale');
});
