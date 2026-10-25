// Token bucket over a fixed window, with an injected clock so it is testable.
//
// Statbate's limit is 120 requests/minute *per account* — not per token, and not
// per IP. Every extra token under one account shares the same bucket, so this
// limiter is owned per account and handed to every client that account uses.

export class RateLimiter {
  #tokens;
  #last;
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
    this.refillPerMs = limit / windowMs;
    this.#tokens = limit;
    this.#last = now();
    this.#blockedUntil = 0;
  }

  #refill(t) {
    const elapsed = t - this.#last;
    if (elapsed > 0) {
      this.#tokens = Math.min(this.limit, this.#tokens + elapsed * this.refillPerMs);
      this.#last = t;
    }
  }

  /** Take a slot if one is available right now. Never waits. */
  tryAcquire(cost = 1) {
    const t = this.now();
    this.#refill(t);
    if (t < this.#blockedUntil) return false;
    if (this.#tokens >= cost) {
      this.#tokens -= cost;
      return true;
    }
    return false;
  }

  /** Milliseconds until `cost` slots are available, respecting any 429 penalty. */
  msUntil(cost = 1) {
    const t = this.now();
    this.#refill(t);
    const waits = [];
    if (t < this.#blockedUntil) waits.push(this.#blockedUntil - t);
    if (this.#tokens < cost) waits.push(Math.ceil((cost - this.#tokens) / this.refillPerMs));
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
    this.#refill(this.now());
    return this.#tokens;
  }

  get blockedForMs() {
    return Math.max(0, this.#blockedUntil - this.now());
  }
}
