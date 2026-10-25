TASK: Correction pass, slice C — OAuth token lifecycle. Fix three accepted findings from an
independent read-only review.

REPO / BOUNDARY
Worktree: /home/hermes/code/perch-c  (branch corr-c-token-lifecycle, base 2f2c9d6)
Node 22, zero runtime dependencies. Run tests with: node --test test/*.test.js
You may edit ONLY: src/oauth/tokens.js, test/oauth.test.js
DO NOT touch anything else. DO NOT commit, push, open a PR, deploy, or make any external call.

BACKGROUND THAT MATTERS
Refresh tokens for this API are SINGLE USE: every refresh returns a new pair and retires the
old one, and a refresh replayed outside a 30-second window is treated as theft and revokes the
entire chain (the user's newest token included). Exactly one refresh must be in flight per
installation. A session that has been cleared must not be resurrected by a refresh that was
already in flight when it was cleared.

FINDINGS TO FIX — each has a reproduction

1. BLOCKING — a late refresh resurrects a signed-out session.
   src/oauth/tokens.js:79 installs the refresh response unconditionally; :95 only drops the
   promise reference. Reproduction: with a deferred refresh, start accessToken(), call clear()
   (logout), then resolve the refresh with a valid new pair — isAuthenticated becomes true
   again. A stale refresh can likewise overwrite a session installed after it started.
   REQUIRED: a refresh result may only be installed if no clear() or set() has happened since
   that refresh began. On a mismatch, discard the result and reflect the CURRENT state (if the
   session is gone, the caller must not receive a usable token).

2. BLOCKING — set() breaks the single-flight guarantee, so the same single-use token is sent
   twice concurrently.
   src/oauth/tokens.js:49 clears `inflight` even while an exchange is still pending.
   Reproduction: set an expired pair, start a deferred refresh, call set() with the same
   expired pair, then request another refresh — the callback receives the SAME refresh token
   twice, concurrently. If the first request consumed it, the second is the replay that revokes
   the chain. REQUIRED: exactly one refresh in flight at a time — concurrent callers must
   coalesce onto the pending promise, and neither set() nor clear() may cause a second
   concurrent send of the same token.

3. NON-BLOCKING — a malformed refresh response preserves a retired refresh token.
   src/oauth/tokens.js:45 keeps the previous refresh token when the response omits its
   replacement; the documented producer always returns a new pair. Reproduction: a refresh
   returning only an access token leaves the retired token stored, and the next refresh sends
   it again. REQUIRED: treat a refresh response with no rotated refresh token as a contract
   violation — clear the session and throw, rather than silently reusing the retired token.
   NOTE: test/oauth.test.js:128 currently asserts the opposite (that the old token is kept).
   That test encodes the bug — replace it with an assertion of the corrected behaviour.

ACCEPTANCE
- `node --test test/*.test.js` is green from this worktree.
- Add a test for EACH of the two blocking reproductions. Both currently pass a green suite, so
  state in your report how you confirmed your new assertions fail before the fix (e.g. you
  reverted the fix and watched them go red).
- Commit nothing. Leave the work in the working tree.

REPORT EXACTLY THIS SHAPE
STATUS: completed | needs_clarification | blocked
FILES: each changed file, one line on what changed
CHECKS: the exact command(s) and the observed pass/fail/skipped counts
FIXES: for each numbered finding — fixed / not fixed / partial, and the assertion that proves it
ASSUMPTIONS: anything you had to decide
RISKS: what a reviewer should look at hardest
