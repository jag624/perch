// Sliding-window log over an injected clock, so it is testable.
//
// Statbate's limit is 120 requests/minute *per account* — not per token, and not
// per IP. Every extra token under one account shares the same bucket, so this
// limiter is owned per account and handed to every client that account uses.
//
// This enforces a hard rolling ceiling: never more than `limit` acquisitions are
// granted inside any windowMs-wide window. A token bucket that refills over time
// permits bursts above the stated per-minute ceiling (capacity + accrued refill);
// a sliding log of acquisition timestamps does not.

export class RateLimiter {
  #timestamps;
  #blockedUntil;

  /**
   * @param {{ limit: number, windowMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} opts
   */
  constructor({ limit, windowMs = 60_000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('RateLimiter: limit must be a positive number');
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('RateLimiter: windowMs must be a positive number');
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.sleep = sleep;
    this.#timestamps = [];
    this.#blockedUntil = 0;
  }

  #prune(t) {
    const cutoff = t - this.windowMs;
    while (this.#timestamps.length && this.#timestamps[0] <= cutoff) this.#timestamps.shift();
  }

  /** Take a slot if one is available right now. Never waits. */
  tryAcquire(cost = 1) {
    const t = this.now();
    if (t < this.#blockedUntil) return false;
    this.#prune(t);
    if (this.#timestamps.length + cost > this.limit) return false;
    for (let i = 0; i < cost; i += 1) this.#timestamps.push(t);
    return true;
  }

  /** Milliseconds until `cost` slots are available, respecting any 429 penalty. */
  msUntil(cost = 1) {
    const t = this.now();
    this.#prune(t);
    const waits = [];
    if (t < this.#blockedUntil) waits.push(this.#blockedUntil - t);
    const over = this.#timestamps.length + cost - this.limit;
    if (over > 0) {
      const oldest = this.#timestamps[over - 1];
      waits.push(Math.max(0, oldest + this.windowMs - t));
    }
    return waits.length ? Math.max(...waits) : 0;
  }

  /** Wait for a slot, then take it. */
  async acquire(cost = 1) {
    for (;;) {
      const wait = this.msUntil(cost);
      if (wait > 0) await this.sleep(wait);
      if (this.tryAcquire(cost)) return;
    }
  }

  /** A 429 (or an explicit Retry-After) blocks the whole account bucket until then. */
  penalize(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.#blockedUntil = Math.max(this.#blockedUntil, this.now() + ms);
  }

  get tokensLeft() {
    this.#prune(this.now());
    return Math.max(0, this.limit - this.#timestamps.length);
  }

  get blockedForMs() {
    return Math.max(0, this.#blockedUntil - this.now());
  }
}
