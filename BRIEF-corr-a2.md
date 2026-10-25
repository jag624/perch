TASK: Correction pass, slice A2 — finish slice A. Four tests are red and the README was never fixed.

WORKTREE: /home/hermes/code/perch-a (branch corr-a-rate-budget)
Run tests with: node --test test/*.test.js
Edit ONLY: test/core.test.js, test/statbate-client.test.js, README.md
DO NOT touch: src/core/rate-limiter.js, src/sources/statbate.js (already correct — see below),
src/core/classify.js, src/core/attention.js, src/core/arrivals.js, src/oauth/*, src/sources/demo.js,
public/index.html
DO NOT commit, push, open a PR, deploy, or make any external call.

WHAT IS ALREADY DONE AND INDEPENDENTLY VERIFIED — DO NOT REDO OR REVERT IT
A previous run replaced the token bucket with a sliding-window log. Hermes verified against the
original reproduction that the first minute now permits exactly 120 acquisitions (it permitted
239 before). The client now REQUIRES a limiter and fails closed with an explanatory error,
offering `unsafeDisableBudget: true` as an explicit test/demo escape. The batch bucket exists in
the source. None of that is in question. Your job is the two halves it did not finish.

PART 1 — THE SUITE IS RED. These four tests construct a client with no limiter:
  not ok 48 - client: 401 and 403 are distinct, actionable errors
  not ok 49 - client: a 500 surfaces as a StatbateError carrying the status
  not ok 50 - client: batch lookups chunk at 100 names and merge, at one request per chunk
  not ok 51 - client: filters junk names out of a batch rather than sending them upstream
  error: "createStatbateClient: limiter is required — build one with createAccountBudget() and
  share it across every client for this Statbate account ... Pass unsafeDisableBudget: true only
  for tests or demo mode that never call the real API."
REQUIRED: make the suite green by updating the TESTS, not by relaxing enforcement. Where a test
is about budgeting, give it a real budget; where it is about something else (chunking, error
mapping), use the explicit escape. Making the limiter optional again is a regression — do not.

PART 2 — the batch bucket is present but unproven. Add an assertion that 21 consecutive
`memberInfoBatch` calls do NOT all reach fetch under the default batch rate. If the default
batch rate makes such a test hang (the client awaits a slot), drive it with an injected clock or
an advancing sleep rather than weakening the client.

PART 3 — README corrections that were never made:
  - README.md around line 38 claims one limiter is created per account and injected into every
    client, and that a scheduler widens polling as tracked rooms grow. Neither exists yet.
    Correct the prose to describe what the code actually does. Do NOT build the scheduler.
  - README.md around line 30 advertises `/health`; src/server.js implements `/api/health`.
    GET /health 404s. Fix the README. Do NOT add a second route — one health route is deliberate.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree.
- Each new assertion fails against the unfixed code; state how you confirmed that.
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: exact command(s) and observed pass/fail/skipped counts
FIXES: for each of the three parts — done / not done / partial, and the assertion that proves it
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
