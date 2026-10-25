TASK: Correction pass, slice B2 — finish slice B. Two findings remain unaddressed.

WORKTREE: /home/hermes/code/perch-b (branch corr-b-classify-rank)
Run tests with: node --test test/*.test.js
Edit ONLY: public/index.html, test/attention.test.js, test/server.test.js, src/sources/demo.js
DO NOT touch: src/core/classify.js, src/core/attention.js, src/core/arrivals.js,
src/core/rate-limiter.js, src/sources/statbate.js, src/oauth/*, README.md
DO NOT commit, push, open a PR, deploy, or make any external call.

WHAT IS ALREADY DONE AND INDEPENDENTLY VERIFIED — DO NOT REDO OR REVERT IT
Hermes verified against the original reproductions that: the tier weights now follow the
documented actionability order (regular 60 > prospect 50); the payer with 1,000 tokens and a tip
yesterday now classifies as `prospect` instead of "Never tipped"; a batch error row
({name, error}) now reads `history_unknown` instead of "no tip history"; the arrival counts are
self-consistent (present 3 / presentCount 3 for one named plus two anonymous); and the windowed
copy ("tokens today", "this week") is gone. The suite is green at 54/54. None of that is in
question.

PART 1 — anonymous viewers are still rendered as individual clickable cards.
public/index.html — the queue renders every entry as a clickable card. Reproduction:
  createDemoSource({ initialPresent: 1 }).live().queue
returns 12 entries, 11 of them with an empty username, and clicking one fetches
/api/viewer?name= (empty) and receives HTTP 400. The design says anonymous viewers are "ranked
last and shown collapsed".
REQUIRED: collapse anonymous viewers into ONE non-clickable summary entry that carries how many
there are (a count, not 11 rows), and make it impossible to click through to a viewer with no
username. Add a test that asserts the collapsed shape — e.g. that a room with one named viewer
produces at most one empty-username queue entry, and that it is marked non-interactive.

PART 2 — two test files named in the brief were never touched, so three assertions still cannot
detect what they claim:
  - test/attention.test.js, the test "queue: ranks by actionability and always explains itself"
    asserts reasons only on queue[0] while its title claims "always".
  - test/server.test.js says "every queue entry must explain itself" but checks only index zero.
    REQUIRED for both: assert over EVERY entry in the queue, not the first.
  - test/server.test.js, the test "the fixture room exercises every tier the classifier can
    produce", omits `history_unknown` from its expected list — and nothing in the fixture can
    currently produce it. Now that a dossier carrying an `error` reads as `history_unknown`,
    make the fixture actually exercise that path (viewers whose dossier lookup failed — realistic,
    since the API permits per-row errors) and include `history_unknown` in the expected list.
    Do NOT simply retitle the test.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree, with more tests than the 54 it has now.
- Each new assertion fails against the unfixed code; state how you confirmed that.
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: exact command(s) and observed pass/fail/skipped counts
FIXES: for each of the two parts — done / not done / partial, and the assertion that proves it
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
