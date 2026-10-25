// "Sign in with Statbate" — OAuth 2.0 authorization code + PKCE.
//
// No client secret: possession of the authorization code is proven with PKCE,
// which is why the client_id is public and can live in a browser bundle. Both
// the verifier and the state must be generated per attempt (`plain` challenge
// method is not accepted by the provider).

import { randomBytes, createHash } from 'node:crypto';

const VERIFIER_BYTES = 32; // -> 43 base64url characters, inside the 43..128 range
const STATE_BYTES = 16;
const INSTALL_ID_ALLOWED = /^[A-Za-z0-9\-._~]{1,128}$/;

export function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

export function createPkce({ verifierBytes = VERIFIER_BYTES, stateBytes = STATE_BYTES } = {}) {
  const verifier = base64Url(randomBytes(verifierBytes));
  const challenge = base64Url(createHash('sha256').update(verifier, 'utf8').digest());
  const state = base64Url(randomBytes(stateBytes));
  return { verifier, challenge, state, method: 'S256' };
}

/**
 * Build the /oauth/authorize URL.
 * @param {{ authorizeUrl: string, clientId: string, redirectUri: string, challenge: string,
 *           state?: string, installId: string, scope?: string[], extra?: Record<string,string> }} opts
 */
export function buildAuthorizeUrl({
  authorizeUrl,
  clientId,
  redirectUri,
  challenge,
  state,
  installId,
  scope = ['profile', 'members:read'],
  extra = {},
}) {
  for (const [name, value] of Object.entries({ authorizeUrl, clientId, redirectUri, challenge, installId })) {
    if (typeof value !== 'string' || !value) throw new Error(`buildAuthorizeUrl: ${name} is required`);
  }
  if (!/^https:/.test(redirectUri)) throw new Error('buildAuthorizeUrl: redirectUri must be HTTPS');
  if (!INSTALL_ID_ALLOWED.test(installId)) throw new Error('buildAuthorizeUrl: installId has characters outside A-Za-z0-9-._~');
  if (challenge.length < 43) throw new Error('buildAuthorizeUrl: challenge must be at least 43 characters');

  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('install_id', installId);
  if (scope.length) url.searchParams.set('scope', scope.join(' '));
  if (state) url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.toString();
}

/** application/x-www-form-urlencoded body for the code exchange. */
export function buildExchangeBody({ code, verifier, clientId, redirectUri }) {
  if (!code || !verifier || !clientId || !redirectUri) throw new Error('buildExchangeBody: code, verifier, clientId and redirectUri are required');
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

/** application/x-www-form-urlencoded body for a refresh. */
export function buildRefreshBody({ refreshToken, clientId }) {
  if (!refreshToken || !clientId) throw new Error('buildRefreshBody: refreshToken and clientId are required');
  return new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
}

/** PKCE challenge for a given verifier — exported so tests can prove the S256 derivation. */
export function challengeFor(verifier) {
  return base64Url(createHash('sha256').update(verifier, 'utf8').digest());
}
