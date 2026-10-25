TASK: Second correction round — close 4 blocking findings and 4 smaller ones from a CLOSURE review.
Every finding below was reproduced by the orchestrator against this exact code before you were
briefed, so the reproductions are facts, not theories.

WORKTREE: /home/hermes/code/perch-fix2 (branch corr-fix2)
Run tests with: node --test test/*.test.js
You may edit ONLY: src/sources/statbate.js, src/oauth/tokens.js, src/core/classify.js,
src/sources/demo.js, test/statbate-client.test.js, test/oauth.test.js, test/classify.test.js,
test/server.test.js, README.md
DO NOT commit, push, open a PR, deploy, or make any external call.

F1 — BLOCKING: the batch budget is created PER CLIENT instead of per account.
src/sources/statbate.js:102 defaults `batchLimiter` to a freshly created `createBatchBudget(...)`.
Reproduction: two clients constructed with the SAME shared account `limiter` made 40 batch fetches
at clock zero — the account limit for batch is 20/min. Each client silently invents its own bucket,
so the account-level ceiling multiplies by the number of clients.
REQUIRED: remove the default creation. Require `batchLimiter` to be passed in, under the same
fail-closed rule as `limiter`; `unsafeDisableBudget: true` still nulls both. The error message and
README must say that BOTH budgets are per account and must be shared across every client for it.

F2 — BLOCKING: the batch budget is acquired OUTSIDE the retry loop, so a retry fetches for free.
src/sources/statbate.js:190 acquires the batch budget once per chunk, then calls `request()`, whose
retry loop re-fetches on 429. Reproduction: 20 batch calls that each received `429 / Retry-After: 0`
and then succeeded produced 40 fetches for 20 acquisitions.
REQUIRED: acquisition must happen for EVERY upstream attempt. Simplest shape: let `request()` take an
extra limiter and acquire it inside the retry loop beside the account limiter.

F3 — BLOCKING: a discarded successful rotation leaves a CONSUMED refresh token stored.
src/oauth/tokens.js — when the generation guard discards a refresh result, storage keeps the old
refresh token even though the provider has already consumed it. Reproduction: set(expired a1/r1);
start a refresh; `set()` the SAME expired pair; resolve the refresh with a2/r2 (discarded); the next
refresh then sends r1 again — observed sequence [r1, r1]. Resending a consumed refresh token is
exactly the replay the contract says revokes the whole chain.
REQUIRED: when a result is discarded and the stored refresh token is the one just consumed, CLEAR the
session and surface AuthRequiredError. Never leave a retired token in storage.

F4 — BLOCKING: the payer gate wrongly requires a last_tip_date.
src/core/classify.js:139. Reproduction: named user, no room spend, dossier
`{all_time_tokens: 1000, models_tipped_2weeks: 3, models_tipped_2weeks_list: ['a','b','c'], last_tip_date: null}`
classifies as `window_shopper` / "Never tipped" while its own reasons read "1,000 tokens in other
rooms" and "tipped 3 models in the last 2 weeks". This is the same contradictory-payer defect the
previous round fixed, recreated for a sibling input.
REQUIRED: evidence of paying = ANY of last_tip_date, first_tip_date, all_time_tokens > 0,
models_tipped_2weeks > 0, models_messaged_2weeks > 0. Use it for the prospect gate and to exclude a
viewer from window_shopper / new_face. A label must never contradict its own reasons.

F5 — the token store throws a ReferenceError that masks the real failure.
src/oauth/tokens.js:110 references `run` in a `finally` that can execute before
`const run = (async () => …)()` has completed its assignment. Reproduction:
`new TokenStore({ refresh: () => { throw new Error('upstream'); } })` then `accessToken()` surfaces
`ReferenceError: Cannot access 'run' before initialization` instead of the upstream error.
REQUIRED: the real error must surface, and `inflight` must not be left holding a settled promise (a
later refresh must still be able to start). Note that `const run = (async () => …)()` cannot be fixed
by reordering alone — the `finally` runs synchronously in that path. Either defer the callback so a
synchronous throw becomes a rejection (`await Promise.resolve().then(() => this.refresh(refreshToken))`)
or restructure equivalently. Add a test using a synchronously-throwing callback.

F6 — a test still does not assert the error class it claims.
test/statbate-client.test.js:128 checks only `err.status` and `err.message` for the claimed
`StatbateError`; replacing that exception with an ordinary `Error` left all 10 client tests passing.
REQUIRED: assert the error IS an instance of the named class.

F7 — two comments overclaim what the code does. Correct them so they describe the FIXED behaviour:
`src/sources/statbate.js` header says batch requests are budgeted against both buckets (untrue on the
retry path today), and `src/oauth/tokens.js`'s guard comment calls discarding the response "replay
prevention" (untrue while the retired token stays stored).

F8 — repair these assertions, which a reviewer showed are not load-bearing:
- test/statbate-client.test.js, "21 consecutive batch calls do not all reach fetch under the default
  20/min batch budget": the test INJECTS its own bucket, so deleting the default creation leaves it
  green, and its title claims "default" coverage it does not provide. Either exercise the default path
  or retitle it honestly.
- test/oauth.test.js: the concurrent-refresh assertion accepts two identical stale tokens and detects
  neither the discarded rotation nor the later replay. Strengthen it so it fails without F3.
- test/server.test.js: `anonymousEntries.length <= 1` is redundant beside `=== 1` — drop it or give it
  a distinct claim.
- The anonymous-collapse assertions all pass with the frontend reverted. Either add an assertion that
  the summary markup carries no click target / `data-name`, or state plainly in your report that the
  rendering itself is unverified by test. Do not quietly leave it looking covered.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree, with more assertions than the 59 it has now.
- Every new or changed assertion must be shown to FAIL against the code before its fix. Say how you
  confirmed that (e.g. revert the fix and watch the specific assertion go red). A green suite is not
  evidence.
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: exact command(s) and observed pass/fail/skipped counts
FIXES: F1–F8, each done / not done / partial, with the reproduction now showing the corrected result
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
