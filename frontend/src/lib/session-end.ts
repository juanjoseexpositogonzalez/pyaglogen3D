/**
 * The seam through which a session ends.
 *
 * The application used to end a session by assigning `window.location.href`
 * straight from the request layer. That made the most important guarantee of
 * all untestable: jsdom ignores the assignment in silence, so an assertion
 * that the user was sent to the sign-in screen passes whether or not it
 * happened — and so does the assertion that they were *not*, which is the one
 * that matters here.
 *
 * Routing it through a signal costs one indirection and buys the ability to
 * prove that a recoverable failure expels nobody.
 */

type SessionEndListener = () => void

const listeners = new Set<SessionEndListener>()

/**
 * Subscribe to session end. Returns the unsubscribe function, so a test or a
 * component can stop listening without reaching into module state.
 */
export function onSessionEnd(listener: SessionEndListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Declare the session over. Only a definitive credential failure may call
 * this: a 401 caused by our own concurrent refreshes is recoverable, and
 * ending the session there is the defect this seam exists to make visible.
 */
export function endSession(): void {
  // Copied before iterating: a listener may unsubscribe while reacting.
  listeners.forEach((listener) => listener())

  if (typeof window !== 'undefined') {
    window.location.href = '/auth/login'
  }
}
