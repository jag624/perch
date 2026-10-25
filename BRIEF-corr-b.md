TASK: Correction pass, slice B — classification, ranking, arrival counts, UI. Fix eight accepted
findings from an independent read-only review.

REPO / BOUNDARY
Worktree: /home/hermes/code/perch-b  (branch corr-b-classify-rank, base 2f2c9d6)
Node 22, zero runtime dependencies. Run tests with: node --test test/*.test.js
You may edit ONLY: src/core/classify.js, src/core/attention.js, src/core/arrivals.js,
src/sources/demo.js, public/index.html, test/classify.test.js, test/attention.test.js,
test/server.test.js
DO NOT touch: src/core/rate-limiter.js, src/sources/statbate.js, src/oauth/*, README.md
(those are slices A and C)
DO NOT commit, push, open a PR, deploy, or make any external call.

BACKGROUND THAT MATTERS
This is a dashboard for a cam streamer that reads third-party analytics and ranks viewers by
"who should I pay attention to in the next 60 seconds". The tier ordering is documented as an
ACTIONABILITY order, and the queue sorts by tier weight first, score second. A viewer's tier
must never contradict the reasons printed beside it.

FINDINGS TO FIX — each has a reproduction

1. BLOCKING — the tier weights invert the documented actionability order.
   src/core/classify.js:28 gives prospect weight 60 and regular weight 50, but the documented
   order puts REGULAR BEFORE PROSPECT, and src/core/attention.js:85 sorts by weight first.
   The owner has confirmed: regular outranks prospect. REQUIRED: make the weights match the
   documented order, and add a test asserting the weights are strictly decreasing in that
   documented order, so the code and the documentation cannot drift apart again.

2. BLOCKING — a known payer is labelled "Never tipped", with reasons contradicting the label.
   src/core/classify.js:153 routes remaining known tippers to window_shopper. Reproduction:
   a registered viewer with zero spend in this room, a dossier with all_time_tokens: 1000,
   last tip yesterday, and models_tipped_2weeks: 1 produces tier window_shopper, label
   "Never tipped", and reasons ["no tip history", "1,000 tokens in other rooms",
   "last tipped 1 days ago"]. REQUIRED: anyone with a recorded tip is not "never tipped".
   Make the prospect gate "has tipped somewhere but never this room" (i.e. last_tip_date is
   present), keeping tip breadth as supporting evidence rather than a gate. Reserve
   window_shopper / new_face for viewers with NO recorded tip anywhere. Add the reproduction
   above as a test.

3. NON-BLOCKING — a batch error row is treated as a valid dossier with no history.
   src/core/classify.js:139 recognises only a falsy dossier as unavailable. A row shaped
   {name:'x', error:'not found'} — which the batch client preserves, and which the API
   explicitly permits per row — yields window_shopper plus "no tip history", whereas null
   yields history_unknown. REQUIRED: treat a dossier carrying an `error` as unavailable.

4. NON-BLOCKING — the arrival counts are self-inconsistent.
   src/core/arrivals.js:46 returns all input viewers as `present` but counts only named
   viewers as `presentCount`: one named viewer plus two anonymous yields length 3 and count 1.
   REQUIRED: make the naming honest — separate the tracked/named count from the total, and
   update every caller (src/sources/demo.js, src/server.js) so nothing reports one as the other.

5. NON-BLOCKING — anonymous viewers are rendered as individual clickable cards.
   public/index.html:129 renders every queue entry as a clickable card. Reproduction: with one
   named viewer present, the queue contains 12 entries, 11 of them blank-name anonymous, and
   clicking one requests an empty name and receives HTTP 400. The design says anonymous viewers
   are "ranked last and shown collapsed". REQUIRED: collapse anonymous viewers into ONE
   non-clickable summary entry that carries their count, and ensure no card is clickable
   unless it has a username.

6. NON-BLOCKING — product copy asserts time windows that are explicitly unverified.
   public/index.html:85 says "tokens today"; src/core/classify.js:110 says "tipping this room
   this week". The project's own rule forbids windowed claims until the upstream field
   semantics are verified against a live token. REQUIRED: remove the window claims
   (e.g. "tokens with this room", "tipping this room recently"). Do not change the underlying
   logic or the tier names.

7. NON-BLOCKING — tests that cannot detect what their titles claim.
   test/attention.test.js:48 says "always explains itself" but checks only queue[0];
   test/server.test.js:59 says "every queue entry" but checks only index zero.
   REQUIRED: assert over EVERY entry, not the first.
   test/server.test.js:26 says "every tier the classifier can produce" but omits
   history_unknown — and in fact nothing in the fixture can produce it. REQUIRED: make the
   fixture exercise history_unknown (add viewers whose dossier lookup failed, which is
   realistic since batch rows can error) and include it in the expected list. Do not simply
   retitle the test.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree.
- Each fix is covered by an assertion that FAILS against the current implementation. State how
  you confirmed that (e.g. you reverted the fix and watched the new assertion go red).
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: the exact command(s) and the observed pass/fail/skipped counts
FIXES: for each numbered finding — fixed / not fixed / partial, and the assertion that proves it
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
