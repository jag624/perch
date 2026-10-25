# perch — Project Context

Read this completely before writing any code. It is context for the session, not a decision record — durable knowledge lives in the vault (see *Vault loop* below), and this repo holds no notes layer.

---

## Purpose

A live companion for cam streamers: a second-monitor dashboard that turns Statbate's analytics into *who is in my room right now, what are they worth, and where should my attention go*, plus a pre-stream prep view and a post-stream review view.

The customer is an independent model first, and a studio roster second. The product's value is **reducing a 300-viewer room to the handful of people worth the next 60 seconds**, and saying why.

## The scope boundary — the one rule that is not negotiable

perch **reads** Statbate's API and **surfaces** the result to the human who is streaming.

It does **not** post or message as other users, does **not** auto-tip, does **not** send fake viewers, does **not** drive a cam-site account by automation, and does **not** scrape the cam sites themselves. Any request to cross that line is a different project with a different risk profile and needs a logged decision in the vault before any code is written. Reasoning: `projects/perch/reference/why-not-viewer-bots.md`.

## Repo map

- `src/core/` — pure logic: injected clock, no network, no filesystem. `rate-limiter.js` (per-account budget), `batch.js` (100-name chunking), `room-feed.js` (feed normalisation), `arrivals.js` (arrival/departure diffing), `classify.js` (tipper tiers + reasons), `attention.js` (ranking).
- `src/sources/statbate.js` — the real HTTP client. `src/sources/demo.js` — deterministic fixture room.
- `src/oauth/` — PKCE and the token store.
- `src/server.js`, `public/index.html` — stdlib server and the dashboard.
- `test/` — `node:test`, no dependencies.

## Build and test

```bash
node --test test/*.test.js
node src/server.js --port 8787 --poll 5
```

Zero runtime dependencies. Adding one needs a stated reason — the portability of the core to a Worker depends on it.

## Hard constraints

1. **Budget per account, injected.** 120 req/min is per Statbate *account* and is shared by every token that account owns; extra tokens and extra IPs do not raise it. Never create a limiter per client — pass one per account.
2. **Never pool tokens.** One end user, one sign-in. Do not serve one user's data to another, do not bulk-extract, do not walk the catalogue, cache sparingly per user, and delete what was stored when the user disconnects.
3. **Tier A vs Tier B.** Per-user sign-in reaches exactly five lookups; everything else needs the user's own Studio Plus token. Do not build a feature that assumes pooled access to Tier B data.
4. **Classification thresholds are uncalibrated guesses.** They live in one object in `classify.js` so they can be tuned, and no measured or windowed claim may appear in UI copy until the field semantics are verified against a live token.
5. **No credentials in this repo**, ever. No `.env` in git; document required config here instead.
6. **Every field must have a consumer.** If a signal does not change what the streamer does in the next 60 seconds (live) or her next session (pre/post), it does not ship.
7. **Reasons are mandatory.** A queue entry with no explanation is noise — `buildAttentionQueue` entries must always carry `reasons`.

## Session rules

1. Read this file before any action.
2. Enter plan mode for anything with 3+ steps or architectural impact; confirm before proceeding.
3. Never mark something complete without demonstrating it works — a passing test or a real request, not an assertion.
4. Commit after each confirmed step with a descriptive message.
5. **Fix the code, not the test.** If a test fails and the expectation is right, the code is wrong. Several tiers and a ranking rule were corrected exactly that way.
6. When the answer to a question is a *fact about the world* (field semantics, plan limits, tier mapping) rather than a design choice, verify it against the live API or Statbate's docs — do not assume it.
7. **Commits here are authored as Javi, deliberately.** The global git identity is `Javier Garcia <jag624@gmail.com>` and commits in this repo are authored as him by his explicit instruction. Do not amend authorship to a bot identity and do not add a co-author trailer — if you spot the attribution and think it looks wrong, it is not; leave it.

## Review status — read before changing anything

This repository has been independently reviewed once and **failed**. Run `cwb-445568979ddd4303bf38c3cb611890d8` (Codex, `gpt-6-astra`, read-only) returned **FAIL with 13 findings, 7 blocking** against revision `2624f4c`: the rate limiter exceeds its stated per-minute ceiling, account budgeting is optional, no separate batch bucket exists, the prospect/regular width order is inverted relative to the design, a payer can be labelled "Never tipped", and the token store's lifecycle mutations defeat its own single-flight refresh. The full list lives in the vault at `projects/perch/decisions-log.md`.

**Corrections to that list are owed and are routed through Claude Code, not authored by Hermes** — the point of the review is independence, and a self-authored correction keeps the same blind spot. Do not silently fix one of these as a side effect of another change; keep them in a single, auditable correction diff.

## Vault loop

On session end, close the loop in `~/jarvis/projects/perch/`:

- `decisions-log.md` — append-only, newest first: what was decided and why.
- `reference/` — edit in place when current state changes (`statbate-api.md`, `live-companion-design.md`).
- `open-items.md` — only work that closes through a person, or a verification that needs a real credential.

Code defects and deferred code tasks go to this repo's GitHub Issues, **not** the vault. Nothing narrative goes into this repo.
