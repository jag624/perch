TASK: Correction pass, slice B3 — turn ONE named red test green. This is a small, bounded edit.

WORKTREE: /home/hermes/code/perch-b (branch corr-b-classify-rank)

SCOPE BOUNDARY — READ THIS FIRST, IT SUPERSEDES AN EARLIER ONE
An earlier brief for this slice said "DO NOT touch src/core/attention.js". That restriction was
about a different correction round and it is WRONG for this task: the change you need lives in
that file. It is superseded. For this brief you may edit:
  src/core/attention.js   (the collapsing logic)
  public/index.html       (stop rendering a clickable card for an entry with no username)
Run tests with: node --test test/*.test.js
DO NOT touch anything else — in particular src/core/classify.js, src/core/arrivals.js,
src/core/rate-limiter.js, src/sources/statbate.js, src/oauth/*, test/attention.test.js,
test/server.test.js, README.md. Every other finding in this repo is already fixed and verified.
DO NOT commit, push, open a PR, deploy, or make any external call.

THE ONE FAILING TEST, VERBATIM
  not ok 42 - demo source: anonymous viewers collapse into one non-interactive summary entry
  location: test/server.test.js:41
  error: 'anonymous viewers must collapse into at most one queue entry'
Its assertions, which you must satisfy WITHOUT weakening any of them:
  const anonymousEntries = live.queue.filter((entry) => entry.username === '');
  anonymousEntries.length <= 1                              // collapse, do not drop
  anonymousEntries.length === 1                             // the fixture still has anonymous viewers
  anonymousEntries[0].interactive === false                 // marked non-interactive
  anonymousEntries[0].count === live.room.anonymous         // carries the REAL anonymous count

WHAT IS WRONG TODAY
`buildAttentionQueue` (src/core/attention.js) emits one ranked entry per viewer, so a room with
one signed-in viewer and eleven anonymous ones produces 12 entries — 11 of them blank-name rows
that the dashboard renders as individual clickable cards, each of which fetches
/api/viewer?name= (empty) and receives HTTP 400. The product design says anonymous viewers are
"ranked last and shown collapsed", which the code never implemented.

REQUIRED
1. Collapse all anonymous viewers into ONE summary entry rather than N entries:
   `username: ''`, `isAnonymous: true`, `interactive: false`, a `count` of how many anonymous
   viewers were present, tier `anonymous`, weight 0, score 0, and a reason that says they cannot
   tip. It must rank last, as today.
2. The count must be the TOTAL number of anonymous viewers in the input, counted BEFORE the
   queue limit is applied — not just those that survive `slice(0, limit)`. The test compares it
   against the room's full anonymous count, so slicing first will fail it.
3. Named entries should carry `interactive: true`.
4. public/index.html: a queue entry with no username must not be rendered as a clickable card
   (no click handler, no data-name, and it must not be able to open the viewer detail fetch).
   Render the summary as one non-interactive row showing the count.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree — all 55 tests, including test 42.
- Do not weaken, skip or delete test 42; it was written to specify this behaviour and it is
  currently red because the behaviour is missing.
- State in your report how you confirmed the new logic is load-bearing (e.g. revert the collapse
  and watch test 42 go red again).
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: exact command(s) and observed pass/fail/skipped counts
FIXES: the confirmed status of test 42, and the assertion that proves it
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
