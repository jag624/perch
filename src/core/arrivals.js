// Arrival / departure detection between two polls of the same room.
//
// Departures matter as much as arrivals: a viewer WITH a tip history who leaves
// after 40 seconds is a missed opportunity, and that is actionable inside the
// current session rather than after it.

export class RoomTracker {
  /** @param {{ now?: () => number }} [opts] */
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    /** @type {Map<string, { user: object, firstSeenAt: number }>} */
    this.seen = new Map();
    this.polls = 0;
  }

  /**
   * @param {Array<{ username: string }>} users normalised viewers present now
   * @returns {{ arrivals: object[], departures: object[], present: object[], presentCount: number, namedCount: number }}
   */
  update(users) {
    const t = this.now();
    this.polls += 1;
    const namedPresent = new Set();
    const arrivals = [];

    for (const user of users) {
      if (!user?.username) continue;
      namedPresent.add(user.username);
      const known = this.seen.get(user.username);
      if (known) {
        known.user = user; // refresh the token totals on every poll
      } else {
        this.seen.set(user.username, { user, firstSeenAt: t });
        arrivals.push({ ...user, firstSeenAt: t });
      }
    }

    const departures = [];
    for (const [username, entry] of this.seen) {
      if (!namedPresent.has(username)) {
        departures.push({ ...entry.user, firstSeenAt: entry.firstSeenAt, dwellMs: t - entry.firstSeenAt });
        this.seen.delete(username);
      }
    }

    // `present` is every viewer handed in this poll, named or not; `presentCount`
    // is honestly its length. `namedCount` is the tracked/named subset — the only
    // group this class can diff arrivals and departures for.
    return { arrivals, departures, present: users, presentCount: users.length, namedCount: namedPresent.size };
  }

  /** Viewers currently tracked, with how long they have been in the room. */
  dwell() {
    const t = this.now();
    return [...this.seen.values()].map(({ user, firstSeenAt }) => ({
      username: user.username,
      dwellMs: t - firstSeenAt,
      firstSeenAt,
    }));
  }

  reset() {
    this.seen.clear();
    this.polls = 0;
  }
}
