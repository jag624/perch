// Deterministic fixture room. Lets the whole pipeline — feed -> arrivals ->
// dossier -> classification -> attention queue -> dashboard — run and be tested
// with no Statbate credential and no network.
//
// The archetypes exist so the demo exercises every tier, including the ones that
// only appear in a real room occasionally (a big spender returning after months).

import { parseRoomFeed } from '../core/room-feed.js';
import { RoomTracker } from '../core/arrivals.js';
import { buildAttentionQueue } from '../core/attention.js';
import { DAY_MS } from '../core/classify.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['grey', 'purple', 'blue', 'dark_blue', 'orange'];

function isoDaysAgo(now, days) {
  return new Date(now - days * DAY_MS).toISOString();
}

function intBetween(rng, min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

/**
 * @param {{ now: number, modelName: string, seed?: number }} opts
 */
function buildPool({ now, modelName, seed }) {
  const rng = mulberry32(seed);
  const pool = [];
  let n = 0;

  const add = (archetype, count, make) => {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      pool.push({ ...make(rng), archetype, index: n });
    }
  };

  add('returning_whale', 3, (r) => {
    const allTime = intBetween(r, 60_000, 200_000);
    return member(`whale_${n}`, {
      color: 'dark_blue',
      room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime: Math.round(allTime * 0.35) },
      allRooms: { hour: 0, thirtyDays: 0, allTime },
      lastTipDaysAgo: intBetween(r, 45, 120),
      breadth: intBetween(r, 4, 10),
      tenureDays: intBetween(r, 400, 1600),
      listContainsModel: true,
    });
  });

  add('whale', 5, (r) => {
    const allTime = intBetween(r, 60_000, 220_000);
    const trailing = intBetween(r, 12_000, 40_000);
    return member(`vip_${n}`, {
      color: 'dark_blue',
      room: { hour: intBetween(r, 50, 400), day: trailing, week: trailing, thirtyDays: trailing, allTime: Math.round(allTime * 0.5) },
      allRooms: { hour: trailing, thirtyDays: trailing, allTime },
      lastTipDaysAgo: intBetween(r, 0, 5),
      breadth: intBetween(r, 1, 4),
      tenureDays: intBetween(r, 200, 1400),
      listContainsModel: true,
    });
  });

  add('regular', 9, (r) => {
    const allTime = intBetween(r, 5_000, 30_000);
    const week = intBetween(r, 100, 2_500);
    return member(`reg_${n}`, {
      color: 'purple',
      room: { hour: intBetween(r, 0, 300), day: week, week, thirtyDays: week * intBetween(r, 1, 3), allTime },
      allRooms: { hour: week, thirtyDays: week * 2, allTime: Math.round(allTime * 1.4) },
      lastTipDaysAgo: intBetween(r, 0, 6),
      breadth: intBetween(r, 1, 3),
      tenureDays: intBetween(r, 90, 1200),
      listContainsModel: true,
    });
  });

  add('prospect', 6, (r) => {
    const allTime = intBetween(r, 8_000, 30_000); // under the whale line on purpose
    return member(`other_${n}`, {
      color: 'blue',
      room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime: 0 },
      allRooms: { hour: intBetween(r, 0, 500), thirtyDays: intBetween(r, 3_000, 9_000), allTime },
      lastTipDaysAgo: intBetween(r, 0, 9),
      breadth: intBetween(r, 6, 15),
      tenureDays: intBetween(r, 120, 900),
      listContainsModel: false,
    });
  });

  add('lapsed', 5, (r) => {
    const allTime = intBetween(r, 8_000, 40_000);
    return member(`quiet_${n}`, {
      color: 'purple',
      room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime },
      allRooms: { hour: 0, thirtyDays: 0, allTime: Math.round(allTime * 1.2) },
      lastTipDaysAgo: intBetween(r, 40, 90),
      breadth: intBetween(r, 1, 5),
      tenureDays: intBetween(r, 300, 1500),
      listContainsModel: true,
    });
  });

  add('new_face', 12, (r) => {
    return member(`new_${n}`, {
      color: 'grey',
      room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime: 0 },
      allRooms: { hour: 0, thirtyDays: 0, allTime: 0 },
      lastTipDaysAgo: null,
      breadth: 0,
      tenureDays: intBetween(r, 2, 20),
      listContainsModel: false,
    });
  });

  add('window_shopper', 24, (r) => {
    return member(`lurker_${n}`, {
      color: 'grey',
      room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime: 0 },
      allRooms: { hour: 0, thirtyDays: 0, allTime: 0 },
      lastTipDaysAgo: null,
      breadth: 0,
      tenureDays: intBetween(r, 200, 1_600),
      listContainsModel: false,
    });
  });

  add('history_unknown', 4, () => ({
    username: `unlookupable_${n}`,
    color: 'grey',
    userType: 'user',
    room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime: 0 },
    allRooms: { hour: 0, thirtyDays: 0, allTime: 0 },
    // A batch row that errored, exactly as the Statbate batch endpoint permits per-row.
    dossier: { name: `unlookupable_${n}`, error: 'not found' },
    lastTipDaysAgo: null,
    tenureDays: null,
    breadth: 0,
  }));

  add('anonymous', 60, () => ({
    username: '',
    color: null,
    userType: 'anonymous',
    room: { hour: 0, day: 0, week: 0, thirtyDays: 0, allTime: 0 },
    allRooms: { hour: 0, thirtyDays: 0, allTime: 0 },
    dossier: null,
  }));

  return pool;
}

function member(username, spec) {
  return {
    username,
    color: spec.color,
    userType: 'user',
    room: spec.room,
    allRooms: spec.allRooms,
    dossier: {
      name: username,
      all_time_tokens: spec.allRooms.allTime,
      last_30_days_tokens: spec.allRooms.thirtyDays,
      last_tip_date: spec.lastTipDaysAgo == null ? null : `__LAST_TIP__${spec.lastTipDaysAgo}`,
      first_message_date: `__TENURE__${spec.tenureDays}`,
      models_tipped_2weeks: spec.breadth,
      models_tipped_2weeks_list: Array.from({ length: spec.breadth }, (_, i) => (spec.listContainsModel && i === 0 ? '@model' : `othermodel${i}`)),
      first_tip_date: spec.lastTipDaysAgo == null ? null : `__FIRST_TIP__${spec.tenureDays}`,
    },
    lastTipDaysAgo: spec.lastTipDaysAgo,
    tenureDays: spec.tenureDays,
    breadth: spec.breadth,
  };
}

/** Turn a pool entry into a raw room-feed row, exactly as the API would send it. */
function toFeedRow(entry, now) {
  return {
    username: entry.username,
    color: entry.color,
    userType: entry.userType,
    tipsHour: entry.room.hour,
    tipsDay: entry.room.day,
    tipsWeek: entry.room.week,
    tipsThirtyDays: entry.room.thirtyDays,
    allTimeTokens: entry.room.allTime,
    tipsAllRoomsHour: entry.allRooms.hour,
    tipsAllRooms: entry.allRooms.allTime,
    tipsAllRoomsThirtyDays: entry.allRooms.thirtyDays,
  };
}

/** Resolve the placeholder dates into real ISO timestamps relative to `now`. */
function toDossier(entry, now, modelName) {
  if (!entry.dossier) return null;
  if (entry.dossier.error) return { ...entry.dossier };
  const d = { ...entry.dossier };
  d.last_tip_date = entry.lastTipDaysAgo == null ? null : isoDaysAgo(now, entry.lastTipDaysAgo);
  d.first_message_date = isoDaysAgo(now, entry.tenureDays);
  d.first_tip_date = entry.lastTipDaysAgo == null ? null : isoDaysAgo(now, entry.tenureDays);
  d.models_tipped_2weeks_list = d.models_tipped_2weeks_list.map((m) => (m === '@model' ? modelName : m));
  return d;
}

/**
 * @param {{ seed?: number, now?: () => number, modelName?: string, site?: string,
 *           roomname?: string, initialPresent?: number, thresholds?: object }} [opts]
 */
export function createDemoSource({
  seed = 7,
  now = () => Date.now(),
  modelName = 'yourroom',
  site = 'chaturbate',
  roomname = 'yourroom',
  initialPresent = 95,
  thresholds,
  queueLimit,
} = {}) {
  const rng = mulberry32(seed + 1);
  const pool = buildPool({ now: now(), modelName, seed });
  const byName = new Map(pool.map((entry) => [entry.username, entry]));
  const named = pool.filter((entry) => entry.username);
  const anonymous = pool.filter((entry) => !entry.username);

  // Present set = a slice of named members plus a chunk of anonymous viewers.
  const present = new Set();
  for (const entry of named) if (rng() < initialPresent / pool.length) present.add(entry.username);
  while (present.size < initialPresent * 0.55 && named.length) present.add(named[Math.floor(rng() * named.length)].username);

  const tracker = new RoomTracker({ now });
  let lastTick = { arrivals: [], departures: [], presentCount: 0, polledAt: now() };
  let polls = 0;

  function currentFeedRows() {
    const rows = [];
    for (const username of present) rows.push(toFeedRow(byName.get(username), now()));
    const anonCount = Math.max(0, Math.round(anonymous.length * 0.35) + Math.round(rng() * 8));
    for (let i = 0; i < anonCount; i += 1) rows.push(toFeedRow(anonymous[i % anonymous.length], now()));
    return rows;
  }

  function tick() {
    polls += 1;
    // Churn: drop ~8% and top the room back up from members not present.
    const current = [...present];
    const leaving = Math.max(1, Math.round(current.length * 0.08));
    const departed = new Set();
    for (let i = 0; i < leaving; i += 1) {
      const victim = current[Math.floor(rng() * current.length)];
      if (victim && present.delete(victim)) departed.add(victim);
    }
    let guard = 0;
    while (present.size < current.length && guard < 500) {
      guard += 1;
      const candidate = named[Math.floor(rng() * named.length)];
      // Never instantly re-add someone who just left: a viewer walking out and
      // straight back in is a churn artefact, not something a streamer can act on.
      if (candidate && !departed.has(candidate.username)) present.add(candidate.username);
    }

    const feed = currentFeed();
    const diff = tracker.update(feed.users);
    lastTick = {
      polledAt: now(),
      presentCount: diff.presentCount,
      arrivals: diff.arrivals.map((v) => v.username).filter(Boolean),
      departures: diff.departures.map((v) => v.username).filter(Boolean),
      bubblesIn: diff.arrivals.length,
      bubblesOut: diff.departures.length,
    };
    return lastTick;
  }

  function currentFeed() {
    return parseRoomFeed({ users: currentFeedRows(), pagination: { total: present.size } });
  }

  function queue(feed = currentFeed()) {
    const entries = feed.users.map((room) => ({
      room,
      member: room.isAnonymous ? null : toDossier(byName.get(room.username), now(), modelName),
      modelName,
      arrivedAt: tracker.seen.get(room.username)?.firstSeenAt ?? null,
    }));
    return buildAttentionQueue(entries, {
      thresholds,
      now: now(),
      ...(queueLimit == null ? {} : { limit: queueLimit }),
    });
  }

  const source = {
    mode: 'demo',
    site,
    modelName,
    roomname,

    tick,
    queue,

    live() {
      const feed = currentFeed();
      const q = queue(feed);
      const anonymousCount = feed.users.filter((u) => u.isAnonymous).length;
      return {
        mode: 'demo',
        room: {
          site,
          name: roomname,
          present: feed.users.length,
          named: feed.users.length - anonymousCount,
          anonymous: anonymousCount,
          tokensToday: feed.users.reduce((sum, u) => sum + u.tokens.room.day, 0),
        },
        polledAt: lastTick.polledAt,
        polls,
        arrivals: lastTick.arrivals.slice(0, 8),
        departures: lastTick.departures.slice(0, 8),
        queue: q,
        columns: feed.columns,
      };
    },

    viewer(name) {
      const entry = byName.get(String(name ?? ''));
      if (!entry) return null;
      const feed = parseRoomFeed({ users: [toFeedRow(entry, now())] });
      const room = feed.users[0];
      const member_ = toDossier(entry, now(), modelName);
      const q = buildAttentionQueue([{ room, member: member_, modelName, arrivedAt: tracker.seen.get(entry.username)?.firstSeenAt ?? null }], {
        thresholds,
        now: now(),
      });
      return {
        username: entry.username,
        archetype: entry.archetype,
        present: present.has(entry.username),
        firstSeenAt: tracker.seen.get(entry.username)?.firstSeenAt ?? null,
        dossier: member_,
        classification: q[0],
        // Illustrative only — in production these come from the two Tier A
        // lookups (top-models, tag-spending) on click, not from a fixture.
        topModels: entry.breadth
          ? Array.from({ length: Math.min(entry.breadth, 4) }, (_, i) => ({
              position: i + 1,
              name: i === 0 && entry.dossier?.models_tipped_2weeks_list?.includes(modelName) ? modelName : `othermodel${i}`,
              total_tokens: Math.round((entry.allRooms.allTime || 1) / (i + 2)),
            }))
          : [],
        tagSpending: entry.breadth
          ? [
              { position: 1, tag: 'feet', name: 'Feet', models_count: 4, total_tokens: Math.round((entry.allRooms.allTime || 1) * 0.3) },
              { position: 2, tag: 'latex', name: 'Latex', models_count: 2, total_tokens: Math.round((entry.allRooms.allTime || 1) * 0.2) },
            ]
          : [],
      };
    },
  };

  // One tick at construction so the source has real arrival state and a populated
  // attention queue before the first request, not an empty first frame.
  tick();

  return source;
}
