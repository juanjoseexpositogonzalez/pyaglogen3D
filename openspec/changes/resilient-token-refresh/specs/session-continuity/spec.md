# session-continuity

Delta del change `resilient-token-refresh`. Capacidad nueva.

## ADDED Requirements

### Requirement: R1. A signed-in session survives ordinary navigation

A signed-in user MUST NOT be returned to the sign-in screen unless their session has genuinely
ended: the refresh token is absent, or the server rejects it when presented on its own.

Losing the in-memory access token is ordinary — it happens on every full page load — and MUST
NOT end the session.

#### Scenario: The screen with the most concurrent requests keeps its session `[manual]`

- GIVEN a signed-in user loading the screen that issues the most concurrent requests
- WHEN every request finds no access token in memory and asks for one
- THEN the user stays on the screen they asked for
- AND the diagnostic reports zero expulsions over the agreed number of runs

### Requirement: R2. At most one refresh is in flight per browsing context

The application MUST NOT present the same refresh token to the server more than once
concurrently. A caller that needs a refreshed access token while a refresh is already running
MUST await that refresh instead of starting another.

The shared refresh MUST be released when it settles, whether it succeeds or fails. A refresh
that is never released leaves the context unable to refresh again, which is a worse failure
than the one being fixed.

#### Scenario: Concurrent callers share one refresh `[test]`

- GIVEN several requests that receive 401 at the same time
- WHEN each asks for a refreshed access token
- THEN exactly one refresh request is sent
- AND every caller resumes with the access token that refresh produced

A retry MUST occupy the same in-flight slot as the refresh it replaces. A retry that runs
outside the shared slot lets a new caller open a second refresh with a different token, which
rebuilds the very collision this change removes.

#### Scenario: A retry keeps later callers waiting `[test]`

- GIVEN a refresh that failed recoverably and is being retried
- WHEN another caller asks for a refreshed access token during the retry
- THEN no second refresh request is sent
- AND the caller resumes with the token the retry produced

#### Scenario: A failed refresh does not block later ones `[test]`

- GIVEN a refresh that fails
- WHEN a later request asks for a refreshed access token
- THEN a new refresh is attempted rather than awaiting the settled one

### Requirement: R3. Waiting for a refresh is bounded

A refresh MUST NOT be awaited indefinitely. When it exceeds its bound, the wait MUST end with a
retryable error, and the stored credentials MUST be left untouched.

This is a direct consequence of R2: once callers share one refresh, a refresh that never
answers would hold the whole context. The bound is what keeps a slow network from becoming a
frozen application.

The bound applies to the **wait**, not to the request. Releasing the slot when the wait expires
would let a second refresh go out while the first is still travelling, rebuilding the collision
this capability removes. **Residual, stated rather than hidden**: if an abandoned request never
settles at all, the context cannot refresh again until the page is reloaded. Every caller fails
with a retryable error and nobody is expelled, but liveness is not restored. Closing that needs
a mechanism this capability does not define.

Ending the wait MUST NOT be assumed to cancel the server's work. A refresh that is abandoned
may still have rotated the token, leaving the stored credential intact and already invalid. The
application MUST therefore re-read storage before treating a later failure as definitive, so
that a slow network cannot turn into an expulsion — the exact symptom this change exists to
remove.

#### Scenario: An abandoned refresh that did rotate is reconciled `[test]`

- GIVEN a refresh whose wait ended before the server answered
- AND the server had already rotated the token
- WHEN the next request needs an access token
- THEN storage is re-read before deciding the failure is definitive
- AND the session is not ended on that first failure

#### Scenario: A refresh that never answers releases its callers `[test]`

- GIVEN a refresh request that does not answer within its bound
- WHEN the bound elapses
- THEN every awaiting caller is rejected with a retryable error
- AND the stored credentials are unchanged
- AND the slot is retained until the abandoned request settles, so a later caller waits
  rather than presenting the same token a second time

### Requirement: R4. A failed refresh is not by itself proof that the session ended

Credentials MUST NOT be discarded because a refresh failed with a non-definitive error. A
refresh whose token was rotated by another refresh is recoverable: the application MUST re-read
the stored token and retry exactly once.

Credentials MUST be discarded only when no token is stored, or when a retry carrying the
currently stored token is itself rejected by the server.

The retry MUST be bounded to a single attempt: a credential that is genuinely invalid has to
end the session promptly rather than loop.

This requirement governs **every** place that reacts to a failed refresh, including the two
401 handlers in `frontend/src/lib/api.ts` (`:82`/`:89` and `:128`/`:133`) and the mount-time
refresh in `frontend/src/contexts/AuthContext.tsx` (`:58`, `:64`). Fixing one path while
another still discards credentials leaves the defect reachable.

#### Scenario: A rotated token is recovered, not discarded `[test]`

- GIVEN a refresh that fails because its token was already rotated
- AND a newer token present in storage
- WHEN the failure is handled
- THEN the stored token is used for exactly one retry
- AND the stored credentials are left in place

#### Scenario: A genuinely invalid token ends the session `[test]`

- GIVEN a refresh that fails while carrying the currently stored token
- WHEN the retry fails as well
- THEN the credentials are discarded
- AND the user is returned to the sign-in screen

#### Scenario: A transport failure does not end the session `[test]`

- GIVEN a refresh or identity request that fails with a network error or a server error
- WHEN the failure is handled at application start
- THEN the stored credentials are left in place
- AND the session is not ended

### Requirement: R5. Signing out cancels work already in flight

When the user signs out, a refresh that answers afterwards MUST NOT restore credentials.

Writing a refresh token also restores the cookie the route middleware reads
(`frontend/src/lib/token-storage.ts:59`), so a late answer would leave the user signed in after
asking to leave. Sharing one refresh between callers widens that window, so the change that
introduces it MUST close it.

Sign-out MUST invalidate on entry, before its own network call. `authApi.logout` clears tokens
in a `finally` (`frontend/src/lib/auth-api.ts:96-106`), so during that round trip the refresh
token is still readable and a 401 arriving then starts a **new** refresh that would write
credentials after the user asked to leave.

#### Scenario: A refresh started during sign-out writes nothing `[test]`

- GIVEN a sign-out in progress
- WHEN a request receives 401 before sign-out completes
- THEN no refresh is started
- AND no credentials are written

#### Scenario: A late refresh after sign-out is discarded `[test]`

- GIVEN a refresh in flight
- WHEN the user signs out before it answers
- AND the refresh then answers successfully
- THEN no access token, refresh token or auth cookie is written
- AND the user remains signed out

### Requirement: R5b. Ending a session is observable

Returning the user to the sign-in screen MUST happen through a seam a test can observe. Today
it is `window.location.href = '/auth/login'` (`frontend/src/lib/api.ts:89` and `:133`), which
jsdom silently ignores: an assertion that the user was redirected passes whether or not it
happened, and so does its negation.

Without this seam, the requirement that matters most — that a recoverable failure does **not**
expel the user — cannot be tested at all.

#### Scenario: A recoverable failure expels nobody `[test]`

- GIVEN a refresh that fails recoverably
- WHEN either 401 handler in `api.ts` processes it, or the mount-time refresh does
- THEN no session-ended signal is emitted
- AND the stored credentials are left in place

#### Scenario: A definitive failure emits the session-ended signal `[test]`

- GIVEN a refresh that fails definitively
- WHEN the failure is handled
- THEN the session-ended signal is emitted exactly once

### Requirement: R6. An anonymous visitor triggers no refresh machinery

A visitor with no stored refresh token MUST NOT cause a refresh request, and MUST NOT be made
to wait on refresh coordination.

This requirement is a **regression guard**, not new behaviour: `api.ts:81`/`:127` already gate
the refresh on a stored token. It exists because this change introduces shared coordination
around refreshing, and coordination placed in the wrong layer would make anonymous pages wait.

#### Scenario: A public page asks for nothing `[test]`

- GIVEN no refresh token in storage
- WHEN a public page loads and issues its requests
- THEN no refresh request is sent
- AND no caller waits on a refresh
- AND the visitor is not redirected

### Requirement: R7. The fix is demonstrated by a repeatable diagnostic

The change MUST ship a diagnostic, versioned in the repository and runnable by someone who did
not write the change, that reports expulsions per scenario.

Because the failure is probabilistic — measured between one and three expulsions in eight runs
— a single passing run MUST NOT be accepted as evidence. The diagnostic MUST support a run
count, aggregate per scenario, and exit non-zero when any run ended at the sign-in screen, so
the claim does not depend on a person reading console output.

The diagnostic MUST distinguish a tab that died from its own rejected refresh from one that
died because another tab discarded the shared credentials. Those have different causes and an
instrument that conflates them argues for the wrong fix.

#### Scenario: The diagnostic reports and fails loudly `[manual]`

- GIVEN the diagnostic committed with this change
- WHEN it is run against a production build with a run count
- THEN it reports expulsions per scenario, separated by cause
- AND its exit status is non-zero if any run ended at the sign-in screen

#### Scenario: Two tabs are re-measured after the in-tab fix `[manual]`

- GIVEN in-tab coalescing is in place
- WHEN the two-tab scenario is measured again
- THEN the expulsion count is recorded in the log
- AND cross-tab coordination is opened as separate work only if expulsions remain
