// Normalisation of the live room feed.
//
// GET /room/{site}/{roomname}/online-users is the spine of the product because it
// is PRE-JOINED: every present viewer already carries their tip totals for THIS
// room and for ALL rooms. That means "spends with me" vs "spends elsewhere" is
// available on the live path with no second request.
//
// Field MEANINGS are not fully pinned yet (rolling vs calendar window, private
// show inclusion, and exactly how allTimeTokens differs from tipsAllRooms). Those
// are tracked in the vault's open-items and must be checked against a live token
// before any UI copy names a time window. This module only coerces the shapes.

/** Coerce whatever the API sent into a finite number. Missing/garbage -> 0. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const ANONYMOUS_TYPES = new Set(['anonymous', 'anon', 'guest', '']);

/**
 * @param {Record<string, unknown>} raw one entry from `users[]`
 */
export function normalizeViewer(raw = {}) {
  const username = String(raw.username ?? '').trim();
  const userType = String(raw.userType ?? '').trim().toLowerCase();
  return {
    username,
    color: raw.color ? String(raw.color).toLowerCase() : null,
    userType,
    // No username, or an anonymous user type: no account exists, so this viewer
    // can never tip. Often the majority of a room, and always noise.
    isAnonymous: !username || ANONYMOUS_TYPES.has(userType),
    tokens: {
      room: {
        hour: toNumber(raw.tipsHour),
        day: toNumber(raw.tipsDay),
        week: toNumber(raw.tipsWeek),
        thirtyDays: toNumber(raw.tipsThirtyDays),
        allTime: toNumber(raw.allTimeTokens),
      },
      allRooms: {
        hour: toNumber(raw.tipsAllRoomsHour),
        thirtyDays: toNumber(raw.tipsAllRoomsThirtyDays),
        allTime: toNumber(raw.tipsAllRooms),
      },
    },
  };
}

/** Tip spend in OTHER rooms, derived. Never negative; semantics unverified. */
export function spendElsewhere(viewer) {
  return Math.max(0, viewer.tokens.allRooms.allTime - viewer.tokens.room.allTime);
}

/**
 * @param {Record<string, unknown>} payload raw response body
 */
export function parseRoomFeed(payload = {}) {
  const rawUsers = Array.isArray(payload.users) ? payload.users : [];
  const users = rawUsers.map(normalizeViewer);
  const total = toNumber(payload?.pagination?.total) || users.length;
  return {
    users,
    cachedAt: payload.cached_at ?? null,
    // Server-defined column set — the table should render from this, not from
    // hard-coded columns, so a column added upstream is not silently dropped.
    columns: Array.isArray(payload.tipsColumns) ? payload.tipsColumns : [],
    pagination: payload.pagination ?? null,
    total,
  };
}
