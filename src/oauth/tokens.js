// Per-user token lifecycle.
//
// The rules that make this non-trivial, from Statbate's own docs:
//   - access token lives 1 hour; refresh token lives 90 days, rolling
//   - a refresh token is SINGLE USE: every refresh returns a new pair and retires
//     the old one
//   - a refresh replayed outside a 30-second window is treated as theft and
//     revokes the whole chain (attacker's copy AND the user's newest token)
//   - keep exactly one refresh in flight per installation
//
// Hence: single-flight here, and on any refresh failure the stored tokens are
// cleared rather than retried — resending a stale refresh token is what triggers
// the chain revocation.

export class AuthRequiredError extends Error {
  constructor(message = 'not signed in') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class TokenStore {
  /**
   * @param {{ refresh: (refreshToken: string) => Promise<object>,
   *           now?: () => number, skewMs?: number, onClear?: (reason: string) => void }} opts
   */
  constructor({ refresh, now = () => Date.now(), skewMs = 60_000, onClear } = {}) {
    if (typeof refresh !== 'function') throw new Error('TokenStore: refresh must be a function');
    this.refresh = refresh;
    this.now = now;
    this.skewMs = skewMs;
    this.onClear = onClear;
    this.state = null; // { accessToken, refreshToken, expiresAt, scope }
    this.inflight = null;
  }

  /** Record a token response (from the exchange or a refresh). */
  set(tokens) {
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) {
      throw new Error('TokenStore.set: access_token is required');
    }
    const expiresIn = Number(tokens.expires_in);
    this.state = {
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : this.state?.refreshToken ?? null,
      expiresAt: this.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
      scope: tokens.scope ?? this.state?.scope ?? null,
    };
    this.inflight = null;
    return this.state;
  }

  get isAuthenticated() {
    return Boolean(this.state?.accessToken);
  }

  needsRefresh() {
    if (!this.state?.accessToken) return true;
    return this.now() >= this.state.expiresAt - this.skewMs;
  }

  /** A usable access token, refreshing first if it is at or near expiry. */
  async accessToken() {
    if (!this.state) throw new AuthRequiredError();
    if (!this.needsRefresh()) return this.state.accessToken;
    return this.refreshNow();
  }

  /** Single-flight refresh: concurrent callers share one in-flight exchange. */
  async refreshNow() {
    if (!this.state) throw new AuthRequiredError();
    if (this.inflight) return this.inflight;
    if (!this.state.refreshToken) throw new AuthRequiredError('no refresh token stored; the user must sign in again');

    const refreshToken = this.state.refreshToken;
    this.inflight = (async () => {
      try {
        const tokens = await this.refresh(refreshToken);
        this.set(tokens);
        return this.state.accessToken;
      } catch (err) {
        // Do NOT retry with the same refresh token — that is the replay that
        // revokes the user's whole chain. Clear and make the user sign in again.
        this.clear(err?.message ?? 'refresh failed');
        throw err;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  clear(reason = 'cleared') {
    this.state = null;
    this.inflight = null;
    this.onClear?.(reason);
  }

  snapshot() {
    if (!this.state) return null;
    return { ...this.state, expiresInMs: this.state.expiresAt - this.now() };
  }
}
