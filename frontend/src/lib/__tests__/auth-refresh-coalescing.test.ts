/**
 * R2 — at most one refresh in flight per browsing context.
 *
 * The access token lives in memory, so every full page load starts without
 * one: the screen's requests all 401 together and each asks for its own
 * refresh. With rotation and blacklisting on the server, the first one wins
 * and the rest present a token that is already invalid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authApi } from '../auth-api'
import { tokenStorage } from '../token-storage'

/** Resolves only when the test says so, to hold a refresh in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const refreshCalls = () =>
  (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
    String(url).includes('/auth/token/refresh/'),
  )

describe('refreshToken coalescing', () => {
  beforeEach(() => {
    tokenStorage.clearTokens()
    tokenStorage.setRefreshToken('refresh-1')
    global.fetch = vi.fn()
  })

  afterEach(() => {
    tokenStorage.clearTokens()
    vi.restoreAllMocks()
  })

  it('sends one refresh request for several concurrent callers', async () => {
    const gate = deferred<Response>()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(gate.promise)

    const callers = [authApi.refreshToken(), authApi.refreshToken(), authApi.refreshToken()]

    // Let the microtask queue drain so every caller has had its chance to
    // start its own request before the first one answers.
    await Promise.resolve()
    await Promise.resolve()

    expect(refreshCalls()).toHaveLength(1)

    gate.resolve({
      ok: true,
      status: 200,
      json: async () => ({ access: 'access-2', refresh: 'refresh-2' }),
    } as Response)

    const results = await Promise.all(callers)
    for (const result of results) expect(result.access).toBe('access-2')
    expect(refreshCalls()).toHaveLength(1)
  })

  it('lets a later caller start a new refresh once the shared one settled', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access: 'access-2', refresh: 'refresh-2' }),
    } as Response)

    await authApi.refreshToken()
    await authApi.refreshToken()

    // A slot that is never released would leave the context unable to refresh
    // again, which is a worse failure than the one being fixed.
    expect(refreshCalls()).toHaveLength(2)
  })

  it('releases the slot when the shared refresh fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    await expect(authApi.refreshToken()).rejects.toThrow()

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access: 'access-3' }),
    } as Response)
    tokenStorage.setRefreshToken('refresh-3')

    await expect(authApi.refreshToken()).resolves.toMatchObject({ access: 'access-3' })
    expect(refreshCalls()).toHaveLength(2)
  })
})
