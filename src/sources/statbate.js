// Statbate API client.
//
// Everything it does is budgeted against ONE RateLimiter per Statbate ACCOUNT,
// because the published limit is 120 requests/minute per account — extra tokens
// under one account share the bucket, and extra IPs do not raise it. The limiter
// is injected rather than owned so a studio-wide scheduler can hand the same
// budget to every room poller.
//
// Verified against the published OpenAPI document. One thing is NOT verified:
// the batch request body shape (`{ names: [...] }` is the reading of the docs'
// "up to 100 names per call, in names[]" for a JSON API). Flagged in the vault's
// open-items; confirm against a live token before trusting it in production.

import { chunk } from '../core/batch.js';
import { RateLimiter } from '../core/rate-limiter.js';

export const DEFAULT_BASE_URL = 'https://plus.statbate.com/api';
export const ACCOUNT_REQUESTS_PER_MINUTE = 120;
export const MINUTE_MS = 60_000;

export class StatbateError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'StatbateError';
    this.status = status;
    this.body = body;
  }
}

/** 401 — the access token is no longer good. Refresh once, then sign in again. */
export class AuthError extends StatbateError {
  constructor(message = 'access token rejected', opts = {}) {
    super(message, { status: 401, ...opts });
    this.name = 'AuthError';
  }
}

/** 403 — the token's plan does not cover this endpoint. Point at upgrade_url. */
export class PlanError extends StatbateError {
  constructor(message = 'plan does not cover this endpoint', opts = {}) {
    super(message, { status: 403, ...opts });
    this.name = 'PlanError';
  }
}

/**
 * Parse a Retry-After header: seconds, or an HTTP date. Falls back when absent.
 */
export function parseRetryAfter(value, { fallbackMs = MINUTE_MS, now = Date.now() } = {}) {
  if (value === null || value === undefined || value === '') return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(String(value));
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return fallbackMs;
}

/** The standard budget: 120 requests/minute for a paid account. */
export function createAccountBudget({ requestsPerMinute = ACCOUNT_REQUESTS_PER_MINUTE, now, sleep } = {}) {
  return new RateLimiter({ limit: requestsPerMinute, windowMs: MINUTE_MS, now, sleep });
}

export function buildUrl(baseUrl, path, query) {
  const url = new URL(`${String(baseUrl).replace(/\/+$/, '')}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
    else url.searchParams.set(key, String(value));
  }
  return url;
}

/**
 * @param {{ token: string, baseUrl?: string, fetchImpl?: typeof fetch, limiter?: RateLimiter,
 *           sleep?: (ms: number) => Promise<void>, maxRetries?: number, now?: () => number }} opts
 */
export function createStatbateClient({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  limiter = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxRetries = 2,
  now = () => Date.now(),
} = {}) {
  if (typeof token !== 'string' || !token) throw new Error('createStatbateClient: token is required');
  if (typeof fetchImpl !== 'function') throw new Error('createStatbateClient: fetchImpl must be a function');

  async function request(path, { method = 'GET', query, body } = {}) {
    const url = buildUrl(baseUrl, path, query);
    let attempt = 0;

    for (;;) {
      if (limiter) await limiter.acquire(1);

      const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
      const init = { method, headers };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      const res = await fetchImpl(url, init);

      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'), { now: now() });
        limiter?.penalize(retryAfterMs);
        if (attempt >= maxRetries) throw new StatbateError('rate limited by Statbate', { status: 429 });
        attempt += 1;
        await sleep(retryAfterMs);
        continue;
      }

      if (res.status === 401) throw new AuthError('access token rejected — refresh or sign in again');
      if (res.status === 403) throw new PlanError('plan does not cover this endpoint — send the user to upgrade_url');
      if (!res.ok) {
        const text = typeof res.text === 'function' ? await res.text().catch(() => null) : null;
        throw new StatbateError(`Statbate request failed with ${res.status}`, { status: res.status, body: text });
      }

      return await res.json();
    }
  }

  return {
    request,
    limiter,

    /** The live feed — the spine of the product. */
    roomOnlineUsers({ site, roomname, page, perPage } = {}) {
      if (!site || !roomname) throw new Error('roomOnlineUsers: site and roomname are required');
      return request(`/room/${encodeURIComponent(site)}/${encodeURIComponent(roomname)}/online-users`, {
        query: { page, per_page: perPage },
      });
    },

    memberInfo({ site, name, timezone } = {}) {
      if (!site || !name) throw new Error('memberInfo: site and name are required');
      return request(`/members/${encodeURIComponent(site)}/${encodeURIComponent(name)}/info`, { query: { timezone } });
    },

    memberTopModels({ site, name, range, timezone } = {}) {
      if (!site || !name) throw new Error('memberTopModels: site and name are required');
      return request(`/members/${encodeURIComponent(site)}/${encodeURIComponent(name)}/top-models`, {
        query: { 'range[0]': range?.[0], 'range[1]': range?.[1], timezone },
      });
    },

    memberTagSpending({ site, name, range, page, perPage } = {}) {
      if (!site || !name) throw new Error('memberTagSpending: site and name are required');
      return request(`/members/${encodeURIComponent(site)}/${encodeURIComponent(name)}/tag-spending`, {
        query: { 'range[0]': range?.[0], 'range[1]': range?.[1], page, per_page: perPage },
      });
    },

    /** Dossiers for up to 100 names per request; larger lists are chunked and merged. */
    async memberInfoBatch({ site, names, chunkSize = 100 } = {}) {
      if (!site) throw new Error('memberInfoBatch: site is required');
      const list = (names ?? []).filter((n) => typeof n === 'string' && n);
      const groups = chunk(list, chunkSize);
      const data = [];
      for (const group of groups) {
        const res = await request(`/members/${encodeURIComponent(site)}/info/batch`, {
          method: 'POST',
          body: { names: group },
        });
        if (Array.isArray(res?.data)) data.push(...res.data);
      }
      return {
        data,
        meta: {
          site,
          requested: list.length,
          found: data.filter((row) => row && !row.error).length,
          requests: groups.length,
        },
      };
    },
  };
}
