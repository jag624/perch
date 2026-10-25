import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeViewer } from '../src/core/room-feed.js';
import { classifyTipper, DEFAULT_THRESHOLDS, DAY_MS } from '../src/core/classify.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const MODEL = 'yourroom';

function room(overrides = {}) {
  return normalizeViewer({ username: 'viewer', userType: 'user', ...overrides });
}

function dossier(overrides = {}) {
  return {
    name: 'viewer',
    all_time_tokens: 0,
    last_30_days_tokens: 0,
    last_tip_date: null,
    first_message_date: new Date(NOW - 400 * DAY_MS).toISOString(),
    models_tipped_2weeks: 0,
    models_tipped_2weeks_list: [],
    ...overrides,
  };
}

const daysAgo = (d) => new Date(NOW - d * DAY_MS).toISOString();

test('classify: an anonymous viewer can never tip and carries zero priority', () => {
  const result = classifyTipper({ room: normalizeViewer({ username: '', userType: 'anonymous' }), now: NOW });
  assert.equal(result.tier, 'anonymous');
  assert.equal(result.weight, 0);
  assert.match(result.reasons.join(' '), /cannot tip/);
});

test('classify: a big past spender who just came back outranks everything', () => {
  const result = classifyTipper({
    room: room({ allTimeTokens: 90_000 }),
    member: dossier({ all_time_tokens: 120_000, last_tip_date: daysAgo(60), models_tipped_2weeks: 6 }),
    modelName: MODEL,
    now: NOW,
  });
  assert.equal(result.tier, 'returning_whale');
  assert.equal(result.weight, 100);
  assert.match(result.reasons[0], /back after 60 days/);
});

test('classify: a currently-spending big spender is a whale', () => {
  const result = classifyTipper({
    room: room({ tipsDay: 9_000, tipsWeek: 9_000, allTimeTokens: 60_000 }),
    member: dossier({ all_time_tokens: 150_000, last_30_days_tokens: 25_000, last_tip_date: daysAgo(2) }),
    modelName: MODEL,
    now: NOW,
  });
  assert.equal(result.tier, 'whale');
  assert.match(result.reasons[0], /whale/);
});

test('classify: tipping this room this week is a regular', () => {
  const result = classifyTipper({
    room: room({ tipsWeek: 800, allTimeTokens: 12_000 }),
    member: dossier({ all_time_tokens: 18_000, last_tip_date: daysAgo(1), models_tipped_2weeks: 2, models_tipped_2weeks_list: [MODEL, 'someone'] }),
    modelName: MODEL,
    now: NOW,
  });
  assert.equal(result.tier, 'regular');
  assert.ok(result.tippedHereRecently);
});

test('classify: a former tipper who has gone quiet is flagged, not forgotten', () => {
  const result = classifyTipper({
    room: room({ allTimeTokens: 20_000 }),
    member: dossier({ all_time_tokens: 24_000, last_tip_date: daysAgo(75) }),
    modelName: MODEL,
    now: NOW,
  });
  assert.equal(result.tier, 'lapsed');
  assert.match(result.reasons[0], /quiet 75 days/);
});

test('classify: someone who pays other models but never this one is a prospect', () => {
  const result = classifyTipper({
    room: room({ tipsAllRooms: 22_000 }),
    member: dossier({
      all_time_tokens: 22_000,
      last_30_days_tokens: 6_000,
      last_tip_date: daysAgo(3),
      models_tipped_2weeks: 9,
      models_tipped_2weeks_list: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    }),
    modelName: MODEL,
    now: NOW,
  });
  assert.equal(result.tier, 'prospect');
  assert.match(result.reasons[0], /never this room/);
  assert.equal(result.elsewhereTokens, 22_000);
});

test('classify: a fresh account with no spend is a new face, a long-lived one is a lurker', () => {
  const fresh = classifyTipper({
    room: room(),
    member: dossier({ first_message_date: daysAgo(5) }),
    now: NOW,
  });
  assert.equal(fresh.tier, 'new_face');

  const old = classifyTipper({
    room: room(),
    member: dossier({ first_message_date: daysAgo(900) }),
    now: NOW,
  });
  assert.equal(old.tier, 'window_shopper');
  assert.match(old.reasons[0], /registered 900 days/);
});

test('classify: a failed dossier lookup says so instead of inventing a history', () => {
  const result = classifyTipper({ room: room(), member: null, modelName: MODEL, now: NOW });
  assert.equal(result.tier, 'history_unknown');
  assert.match(result.reasons.join(' '), /no dossier returned/);
});

test('classify: a lookup failure still uses the live feed for someone who tipped here', () => {
  const result = classifyTipper({ room: room({ tipsWeek: 600, allTimeTokens: 4_000 }), member: null, now: NOW });
  assert.equal(result.tier, 'regular');
});

test('classify: thresholds are injectable so they can be calibrated on real data', () => {
  const input = {
    room: room({ allTimeTokens: 30_000 }),
    member: dossier({ all_time_tokens: 30_000, last_tip_date: daysAgo(2) }),
    now: NOW,
  };
  assert.equal(classifyTipper(input).tier, 'regular');
  assert.equal(classifyTipper({ ...input, thresholds: { ...DEFAULT_THRESHOLDS, whaleAllTimeTokens: 25_000 } }).tier, 'whale');
});
