/**
 * R3 — waiting for a refresh is bounded.
 *
 * This bound is a direct consequence of coalescing: once every caller awaits
 * one refresh, a refresh that never answers holds the whole context. Before
 * coalescing each request hung on its own; after it, one hung request would
 * freeze the page.
 *
 * Ending the wait is NOT the same as cancelling the server's work: the server
 * may still rotate the token. So the bound must leave the stored credentials
 * alone — treating a slow network as a dead session is the exact symptom this
 * change exists to remove.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tokenStorage } from '../token-storage'

type AuthApiModule = typeof import('../auth-api')

/**
 * The in-flight slot is module state, so it outlives a test. Without a fresh
 * module per test, a later test joins the refresh an earlier one left hanging
 * and never exercises its own: the symptom is a test that measures the first
 * test's request while appearing to measure its own.
 */
async function freshAuthApi(): Promise<AuthApiModule> {
  vi.resetModules()
  return import('../auth-api')
}

/**
 * Drains microtasks until the condition holds, with a bound so a genuine
 * failure still fails instead of hanging.
 */
async function flushUntil(condition: () => boolean, limit = 50): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (condition()) return
    await Promise.resolve()
  }
}

describe('refreshToken bounded wait', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    tokenStorage.clearTokens()
    tokenStorage.setRefreshToken('refresh-1')
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    tokenStorage.clearTokens()
    vi.restoreAllMocks()
  })

  it('rejects the waiters when the refresh never answers', async () => {
    const { REFRESH_TIMEOUT_MS, authApi } = await freshAuthApi()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))

    const pending = authApi.refreshToken()
    const assertion = expect(pending).rejects.toThrow(/timed out/i)

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 1)
    await assertion
  })

  it('leaves the stored credentials untouched when the wait ends', async () => {
    const { REFRESH_TIMEOUT_MS, authApi } = await freshAuthApi()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))

    const pending = authApi.refreshToken()
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 1)
    await assertion

    // The server may well have rotated the token. Discarding the credential
    // here would turn a slow network into an expulsion.
    expect(tokenStorage.getRefreshToken()).toBe('refresh-1')
  })

  it('does not open a second refresh while the abandoned one is still running', async () => {
    const { REFRESH_TIMEOUT_MS, authApi } = await freshAuthApi()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))

    const first = authApi.refreshToken()
    const firstAssertion = expect(first).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 1)
    await firstAssertion

    // Giving up on the wait must not free the slot: the request is still out
    // there and may already have rotated the token. A second request now
    // would present a token the server is about to invalidate, rebuilding
    // the collision this change removes.
    const second = authApi.refreshToken()
    const secondAssertion = expect(second).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 1)
    await secondAssertion

    const refreshCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
      String(url).includes('/auth/token/refresh/'),
    )
    expect(refreshCalls).toHaveLength(1)
  })

  it('still stores the token if the abandoned refresh lands afterwards', async () => {
    const { REFRESH_TIMEOUT_MS, authApi } = await freshAuthApi()
    let settle!: (value: Response) => void
    ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Response>((resolve) => {
        settle = resolve
      }),
    )

    const pending = authApi.refreshToken()
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 1)
    await assertion

    settle({
      ok: true,
      status: 200,
      json: async () => ({ access: 'access-2', refresh: 'refresh-2' }),
    } as Response)
    // The answer travels through `.json()`, so it lands several microtasks
    // later. Draining a fixed number of them would tie the test to the
    // implementation's await count; this waits for the observable effect.
    // With fake timers installed, yielding to the real queue once is what
    // lets the resolved fetch resume; draining microtasks alone never does.
    await vi.runAllTimersAsync()
    await flushUntil(() => tokenStorage.getRefreshToken() === 'refresh-2')

    // The rotation happened on the server whether we waited or not; keeping
    // the answer is what prevents the next attempt from failing definitively.
    expect(tokenStorage.getRefreshToken()).toBe('refresh-2')
  })
})
