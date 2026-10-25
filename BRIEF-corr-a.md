TASK: Correction pass, slice A — request budgeting. Fix six accepted findings from an independent read-only review.

REPO / BOUNDARY
Worktree: /home/hermes/code/perch-a  (branch corr-a-rate-budget, base 2f2c9d6)
Node 22, zero runtime dependencies. Run tests with: node --test test/*.test.js
You may edit ONLY: src/core/rate-limiter.js, src/sources/statbate.js, test/core.test.js,
test/statbate-client.test.js, README.md
DO NOT touch: src/core/classify.js, src/core/attention.js, src/core/arrivals.js,
src/oauth/*, src/sources/demo.js, public/index.html  (those are slices B and C)
DO NOT commit, push, open a PR, deploy, or make any external call.

BACKGROUND THAT MATTERS
Statbate's documented limit is 120 requests/minute PER ACCOUNT — shared by every token the
account owns, and NOT raised by extra IPs. The batch endpoints have their own, separate
bucket (20/min on the full-API tier). This project's stated hard constraint is that the
account budget is never exceeded.

FINDINGS TO FIX — each has a reproduction you can run

1. BLOCKING — the limiter permits 239 requests inside one wall-clock minute.
   src/core/rate-limiter.js:31 builds a token bucket with capacity = limit that also refills.
   Reproduction: with limit 120 / windowMs 60000 and an injected clock, acquire 120 slots at
   t=0, then one every 500 ms to t=59,500 — all 239 acquisitions succeed. A bucket enforces an
   average rate, not the stated per-minute ceiling, and retries spend replenished slots too.
   REQUIRED: enforce a hard rolling ceiling — never more than `limit` acquisitions inside any
   window of `windowMs`. A sliding-window of acquisition timestamps, or a fixed-window counter,
   both qualify; a bucket that permits burst+refill does not. Keep the injectable clock, the
   `tryAcquire` / `msUntil` / `acquire` / `penalize` surface, and keep a 429 penalty able to
   block even when capacity is free. The 239 case must become exactly 120 in the first minute.

2. BLOCKING — budgeting is optional, contrary to the stated hard constraint.
   src/sources/statbate.js:81 defaults `limiter` to null and :94 silently skips budgeting.
   Reproduction: constructing a client with only a token and a mock fetch let 121 requests
   reach fetch. REQUIRED: a limiter must be REQUIRED — constructing a client without one fails
   closed with a clear error. If you want an escape for tests/demo, make it an explicit,
   loudly-named option that no production path uses. ALSO: README.md:38 claims one limiter is
   created per account and injected into every client, and that a scheduler widens polling as
   rooms grow. Neither exists yet. Correct the claim to describe what the code actually does;
   do not build the scheduler (that is a later milestone).

3. BLOCKING — the batch-specific budget is not enforced.
   src/sources/statbate.js:163 uses only the general account budget. Reproduction: with one
   account limiter and a fixed clock, 21 consecutive memberInfoBatch calls all reached fetch.
   REQUIRED: support a separate, independently-configurable batch bucket and acquire from BOTH.
   Default the batch bucket to 20/min, and make the rate configurable so the sign-in tier's
   documented 120/min batch bucket can be set instead. Test that 21 consecutive batch calls do
   NOT all reach fetch under the default.

4. NON-BLOCKING — a test claims to verify the account penalty but does not.
   test/statbate-client.test.js:47 asserts only the retry count, the requested sleep and the
   response — replacing RateLimiter.prototype.penalize with a no-op in memory left all nine
   client tests passing. REQUIRED: assert the penalty's actual effect (e.g. that the limiter
   then refuses an acquisition, or reports a positive blocked duration).

5. NON-BLOCKING — a test claims a StatbateError but only checks status and message.
   test/statbate-client.test.js:105. An ordinary Error carrying those properties passes.
   REQUIRED: assert the error is an instance of the class it names.

6. NON-BLOCKING — README.md:30 advertises `/health`; src/server.js:57 implements `/api/health`.
   GET /health falls through to 404. REQUIRED: fix the README. Do NOT add a second route —
   one health route is deliberate.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree.
- Each fix is covered by an assertion that FAILS against the current implementation. State in
  your report how you satisfied yourself of that (e.g. you reverted the fix and watched the
  new assertion go red) — a green suite is not evidence on its own.
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: the exact command(s) and the observed pass/fail/skipped counts
FIXES: for each numbered finding — fixed / not fixed / partial, and the assertion that proves it
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
