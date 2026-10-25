# perch

Live companion for cam streamers. Reads **Statbate** analytics and puts them in front of the human who is streaming: who is in the room right now, what they are actually worth, and where the next 60 seconds of attention should go.

**perch only reads and surfaces.** It never posts as other users, never auto-tips, never injects viewers, and never automates a cam-site account. That boundary is deliberate and is recorded in the vault (`projects/perch/reference/why-not-viewer-bots.md`).

Not affiliated with Statbate, Chaturbate, Stripchat, CamSoda or MFC. All data comes from the Statbate API and belongs to the Statbate user it was read for.

## Run it

No dependencies, Node 22+:

```bash
node src/server.js --port 8787 --poll 5   # dashboard + JSON API in demo mode
node --test test/*.test.js                # 51 tests, no network, no credential
```

Then open `http://localhost:8787`. Demo mode drives a deterministic fixture room, so the full pipeline runs — and can be tested — without a Statbate account.

## Layout

```
src/core/       pure logic, injected clock, no I/O  (rate limiter, batching, room-feed
                normalisation, arrival diffing, tipper classification, attention ranking)
src/sources/    statbate.js  — the real fetch client (bearer auth, 429 + Retry-After
                               backoff, account-budget aware, batch chunking)
                demo.js      — deterministic fixture room covering every tipper tier
src/oauth/      pkce.js   — verifier/challenge/state, authorize URL, token bodies
                tokens.js — single-flight refresh honouring the single-use refresh rule
src/server.js   stdlib node:http — /api/health, /api/live, /api/viewer, POST /api/tick, dashboard
public/         the dashboard (dark, glanceable, no build step, no external assets)
```

The core is platform-agnostic on purpose: the same engine is intended to run under `node --test`, under this dev server, and later in a Worker without a rewrite.

## Two hard constraints the code is shaped around

**The rate limit is per Statbate *account*, not per token or per IP** — 120 requests/minute, shared by every token that account owns. `createStatbateClient` requires a `RateLimiter` to be passed in — build one with `createAccountBudget()` and reuse that same instance across every client made for that account; the client fails closed with an explanatory error if none is supplied, rather than quietly going unbudgeted (tests and demo mode can opt out with `unsafeDisableBudget: true`). There is no scheduler yet that widens the poll interval as tracked rooms grow — each room's poll cadence is set independently by the caller.

**Two access tiers, not interchangeable.** "Sign in with Statbate" (per-user OAuth + PKCE, scopes `profile` + `members:read`) is the only multi-tenant-safe path, and it opens exactly five lookups — one of which is the live room feed. Everything richer (model rank, sessions, earnings, tags, leaderboards, presence) needs each user's **own** Studio Plus token, which cannot be pooled without breaching Statbate's terms.

## What is verified, and what is not

Verified: every endpoint, schema and limit in the client and the design was read off Statbate's published OpenAPI document; the engine's behaviour is covered by tests.

**Not verified — do not put these in product copy:** the live feed's window semantics (`tipsDay/Week/ThirtyDays` rolling vs calendar, private-show inclusion, how `allTimeTokens` differs from `tipsAllRooms`), the `color` → membership-tier mapping, the classification thresholds, the batch request-body shape, and whether a session-scoped dossier memory is defensible under Statbate's "no growing local mirror" rule. All are tracked with triggers in the vault's `projects/perch/open-items.md`.

Durable project knowledge lives in the vault at `projects/perch/`, not in this repo.
