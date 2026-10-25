# session-continuity

Delta del change `resilient-token-refresh`. Capacidad nueva.

## ADDED Requirements

### Requirement: R1. A signed-in session survives ordinary navigation

A user who is signed in and navigating the application MUST NOT be returned to the sign-in
screen unless their session has genuinely ended: the refresh token is absent, expired, or
rejected by the server when presented on its own.

Losing the in-memory access token is ordinary: it happens on every full page load. It MUST NOT
end the session.

#### Scenario: A data-heavy screen keeps the session `[test]`

- GIVEN a signed-in user whose access token is not in memory, as after a full page load
- WHEN they open the screen that issues the most concurrent requests
- THEN every request completes against a valid access token
- AND the user stays on the screen they asked for

#### Scenario: Two tabs keep each other's session `[test]`

- GIVEN a signed-in user with two tabs of the application open
- WHEN both tabs load at the same time with no access token in memory
- THEN neither tab is returned to the sign-in screen
- AND both finish with a usable session

### Requirement: R2. At most one refresh is in flight per browsing context

The application MUST NOT present the same refresh token to the server more than once
concurrently. Requests that need a refreshed access token while a refresh is already running
MUST await that refresh rather than start another.

#### Scenario: Concurrent failures share one refresh `[test]`

- GIVEN several requests that receive 401 at the same time
- WHEN each asks for a refreshed access token
- THEN exactly one refresh request is sent
- AND every caller resumes with the access token that refresh produced

### Requirement: R3. Refreshes are serialised across tabs of the same origin

Tabs of the same origin share stored credentials, so they MUST coordinate their refreshes.
The application MUST hold an origin-scoped lock for the duration of a refresh.

Where such a lock is unavailable, the application MUST fall back to bounded retry, and MUST
NOT fall back to ending the session. Absence of the mechanism may make the application slower;
it MUST NOT make it less correct than before.

#### Scenario: A second tab waits rather than competing `[test]`

- GIVEN one tab holding the refresh lock
- WHEN a second tab needs a refreshed access token
- THEN it waits for the lock instead of sending its own refresh
- AND it proceeds with the token the first tab obtained

#### Scenario: Without locks, behaviour degrades to retry `[test]`

- GIVEN a context where the locking mechanism is unavailable
- WHEN two refreshes collide
- THEN the loser retries with the stored token
- AND the session is not ended

### Requirement: R4. A failed refresh is not by itself proof that the session ended

Credentials MUST NOT be discarded on any failed refresh. A refresh that fails because its
token was rotated by another refresh is recoverable: the application MUST re-read the stored
token and retry once.

Credentials MUST be discarded only when no token is stored, or when a retry carrying the
currently stored token is itself rejected.

The retry MUST be bounded to a single attempt, so that a genuinely invalid credential ends the
session promptly instead of looping.

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

### Requirement: R5. The fix is demonstrated by a repeatable diagnostic

The change MUST ship a diagnostic that measures expulsions per scenario and can be run by
someone who did not write the change.

Because both failing scenarios are probabilistic — measured at one in three and two in three —
a single passing run MUST NOT be accepted as evidence. The diagnostic MUST be run repeatedly
and report the count, so that the claim is a number rather than an impression.

#### Scenario: The diagnostic reports expulsions per scenario `[manual]`

- GIVEN the diagnostic committed with this change
- WHEN it is run against a production build repeatedly
- THEN it reports, per scenario, how many runs ended in the sign-in screen
- AND the recorded figure after the change is zero over the agreed number of runs
