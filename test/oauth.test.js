import test from 'node:test';
import assert from 'node:assert/strict';

import { createPkce, challengeFor, buildAuthorizeUrl, buildExchangeBody, buildRefreshBody } from '../src/oauth/pkce.js';
import { TokenStore, AuthRequiredError } from '../src/oauth/tokens.js';

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

test('pkce: the verifier is the right shape and the challenge is its S256 digest', () => {
  const { verifier, challenge, state, method } = createPkce();
  assert.match(verifier, VERIFIER_RE);
  assert.equal(method, 'S256');
  assert.equal(challenge, challengeFor(verifier), 'the provider only accepts S256');
  assert.equal(challenge.length, 43);
  assert.ok(state.length >= 15, 'state must be unpredictable');
});

test('pkce: two attempts never reuse a verifier or a state', () => {
  const a = createPkce();
  const b = createPkce();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, b.state);
});

test('pkce: the authorize URL carries every parameter the provider requires', () => {
  const { challenge, state } = createPkce();
  const url = new URL(buildAuthorizeUrl({
    authorizeUrl: 'https://plus.statbate.com/oauth/authorize',
    clientId: 'client-123',
    redirectUri: 'https://app.example/oauth/statbate/callback',
    challenge,
    state,
    installId: 'install-abc',
    scope: ['profile', 'members:read'],
  }));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('install_id'), 'install-abc');
  assert.equal(url.searchParams.get('scope'), 'profile members:read');
  assert.equal(url.searchParams.get('state'), state);
});

test('pkce: rejects an insecure redirect and a malformed install id before the user sees a broken page', () => {
  const { challenge } = createPkce();
  const base = {
    authorizeUrl: 'https://plus.statbate.com/oauth/authorize',
    clientId: 'c',
    redirectUri: 'https://app.example/cb',
    challenge,
    installId: 'ok-id',
  };
  assert.throws(() => buildAuthorizeUrl({ ...base, redirectUri: 'http://app.example/cb' }), /HTTPS/);
  assert.throws(() => buildAuthorizeUrl({ ...base, installId: 'bad id!' }), /installId/);
  assert.throws(() => buildAuthorizeUrl({ ...base, clientId: '' }), /clientId/);
});

test('pkce: exchange and refresh bodies are form-encoded as the token endpoint expects', () => {
  const exchange = buildExchangeBody({ code: 'c0de', verifier: 'v'.repeat(43), clientId: 'client', redirectUri: 'https://app.example/cb' });
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('code_verifier'), 'v'.repeat(43));
  const refresh = buildRefreshBody({ refreshToken: 'r1', clientId: 'client' });
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('refresh_token'), 'r1');
  assert.throws(() => buildRefreshBody({ refreshToken: '', clientId: 'c' }), /required/);
});

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('tokens: a live access token is handed out without a refresh', async () => {
  const c = clock();
  let refreshes = 0;
  const store = new TokenStore({ now: c.now, refresh: async () => { refreshes += 1; return { access_token: 'new', expires_in: 3600 }; } });
  store.set({ access_token: 'live', refresh_token: 'r1', expires_in: 3600 });
  assert.equal(await store.accessToken(), 'live');
  assert.equal(refreshes, 0);
});

test('tokens: a near-expiry token refreshes exactly once even under concurrent callers', async () => {
  const c = clock();
  let refreshes = 0;
  const store = new TokenStore({
    now: c.now,
    refresh: async (refreshToken) => {
      refreshes += 1;
      assert.equal(refreshToken, 'r1', 'the refresh token must be the one on file');
      await new Promise((r) => setTimeout(r, 5));
      return { access_token: 'refreshed', refresh_token: 'r2', expires_in: 3600 };
    },
  });
  // expires_in below the skew, so the token is treated as needing a refresh now.
  store.set({ access_token: 'stale', refresh_token: 'r1', expires_in: 10 });

  const [a, b] = await Promise.all([store.accessToken(), store.accessToken()]);
  assert.equal(refreshes, 1, 'two workers must not burn the single-use refresh token twice');
  assert.equal(a, 'refreshed');
  assert.equal(b, 'refreshed');
  assert.equal(store.snapshot().refreshToken, 'r2', 'the rotated refresh token is kept');
  assert.equal(await store.accessToken(), 'refreshed', 'the new token is now served without another refresh');
  assert.equal(refreshes, 1);
});

test('tokens: a failed refresh clears the session instead of replaying the refresh token', async () => {
  const c = clock();
  let refreshes = 0;
  const cleared = [];
  const store = new TokenStore({
    now: c.now,
    onClear: (reason) => cleared.push(reason),
    refresh: async () => { refreshes += 1; throw new Error('invalid_grant'); },
  });
  store.set({ access_token: 'stale', refresh_token: 'r1', expires_in: 10 });

  await assert.rejects(() => store.accessToken(), /invalid_grant/);
  assert.equal(refreshes, 1);
  assert.equal(store.isAuthenticated, false);
  assert.equal(cleared.length, 1);

  // The replay that revokes a user's whole chain must never happen.
  await assert.rejects(() => store.accessToken(), AuthRequiredError);
  assert.equal(refreshes, 1, 'a cleared session must not resend the old refresh token');
});

test('tokens: set() rejects a response that omits the rotated refresh token', () => {
  const c = clock();
  const cleared = [];
  const store = new TokenStore({
    now: c.now,
    onClear: (reason) => cleared.push(reason),
    refresh: async () => ({ access_token: 'x', expires_in: 3600 }),
  });
  store.set({ access_token: 'a', refresh_token: 'r1', expires_in: 3600 });

  assert.throws(() => store.set({ access_token: 'b', expires_in: 3600 }), /refresh_token/);
  assert.equal(store.isAuthenticated, false, 'a contract violation must not leave the retired refresh token usable');
  assert.equal(cleared.length, 1);
});

test('tokens: a refresh that resolves after clear() must not resurrect the session', async () => {
  const c = clock();
  let resolveRefresh;
  const store = new TokenStore({
    now: c.now,
    refresh: () => new Promise((resolve) => { resolveRefresh = resolve; }),
  });
  store.set({ access_token: 'stale', refresh_token: 'r1', expires_in: 10 });

  const pending = store.accessToken();
  store.clear('user signed out');
  resolveRefresh({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });

  await assert.rejects(() => pending, AuthRequiredError);
  assert.equal(store.isAuthenticated, false, 'a late refresh must not resurrect a cleared session');
});

test('tokens: set() must not let a concurrent caller re-send the same refresh token', async () => {
  const c = clock();
  const seen = [];
  let resolveRefresh;
  const store = new TokenStore({
    now: c.now,
    refresh: (refreshToken) => {
      seen.push(refreshToken);
      return new Promise((resolve) => { resolveRefresh = resolve; });
    },
  });
  store.set({ access_token: 'stale', refresh_token: 'r1', expires_in: 10 });

  const first = store.refreshNow();
  // e.g. a racing exchange re-installs the same (still expired) pair mid-flight.
  store.set({ access_token: 'stale', refresh_token: 'r1', expires_in: 10 });
  const second = store.refreshNow();

  assert.equal(seen.length, 1, 'only one refresh may be sent for a given refresh token at a time');

  resolveRefresh({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, 'concurrent callers must coalesce onto the same in-flight refresh and see the same result');
});
