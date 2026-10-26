/**
 * R4 — a failed refresh is not by itself proof that the session ended.
 * R5b — ending a session happens through a seam a test can observe.
 *
 * Today any failed refresh discards the credentials, so a 401 caused by our
 * own concurrency is treated exactly like a stolen token. And the user-visible
 * symptom is produced by `window.location.href`, which jsdom ignores in
 * silence: an assertion that the user was redirected passes whether or not it
 * happened, and so does its negation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tokenStorage } from '../token-storage'

/**
 * Resetting modules gives `auth-api` a fresh copy of `session-end` too, so a
 * listener registered on the statically imported one would never hear the
 * signal: the code would call the seam and the test would watch a different
 * instance of it. Both come from the same reset graph.
 */
async function freshAuth() {
  vi.resetModules()
  const [authApiModule, sessionEndModule] = await Promise.all([
    import('../auth-api'),
    import('../session-end'),
  ])
  return { authApi: authApiModule.authApi, onSessionEnd: sessionEndModule.onSessionEnd }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('refresh failure classification', () => {
  let ended: number

  beforeEach(() => {
    ended = 0
    tokenStorage.clearTokens()
    tokenStorage.setRefreshToken('refresh-1')
    global.fetch = vi.fn()
  })

  afterEach(() => {
    tokenStorage.clearTokens()
    vi.restoreAllMocks()
  })

  it('recovers when the token was rotated by another refresh', async () => {
    const { authApi, onSessionEnd } = await freshAuth()
    const stop = onSessionEnd(() => { ended += 1 })

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementationOnce(async () => {
      // Another refresh rotated the token while this one was in flight.
      tokenStorage.setRefreshToken('refresh-2')
      return jsonResponse(401, { detail: 'Token is blacklisted' })
    })
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { access: 'access-9' }))

    await expect(authApi.refreshToken()).resolves.toMatchObject({ access: 'access-9' })

    // The credential that works is still there, and nobody was expelled.
    expect(tokenStorage.getRefreshToken()).toBe('refresh-2')
    expect(ended).toBe(0)
    stop()
  })

  it('retries exactly once, then gives up', async () => {
    const { authApi, onSessionEnd } = await freshAuth()
    const stop = onSessionEnd(() => { ended += 1 })

    // The token stops moving after a few attempts, so an implementation that
    // retried without bound ends with too many calls instead of spinning
    // forever. A guard that only catches a defect by hanging is a timeout in
    // CI, not a diagnosis.
    let attempts = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async () => {
      attempts += 1
      // Must differ from what the caller presented, or it is not a rotation.
      if (attempts <= 4) tokenStorage.setRefreshToken(`refresh-rotated-${attempts}`)
      return jsonResponse(401, {})
    })

    await expect(authApi.refreshToken()).rejects.toThrow()

    // A credential that keeps being rejected must end the session promptly
    // rather than loop: exactly one retry.
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/token/refresh/'),
    )
    expect(refreshCalls).toHaveLength(2)
    expect(ended).toBe(1)
    stop()
  })

  it('ends the session when the stored token is itself rejected', async () => {
    const { authApi, onSessionEnd } = await freshAuth()
    const stop = onSessionEnd(() => { ended += 1 })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(401, {}))

    await expect(authApi.refreshToken()).rejects.toThrow()

    expect(tokenStorage.getRefreshToken()).toBeNull()
    expect(ended).toBe(1)
    stop()
  })

  it('keeps the session on a transport failure', async () => {
    const { authApi, onSessionEnd } = await freshAuth()
    const stop = onSessionEnd(() => { ended += 1 })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(authApi.refreshToken()).rejects.toThrow()

    // A network blip is not a revoked credential.
    expect(tokenStorage.getRefreshToken()).toBe('refresh-1')
    expect(ended).toBe(0)
    stop()
  })

  it('keeps the session on a server error', async () => {
    const { authApi, onSessionEnd } = await freshAuth()
    const stop = onSessionEnd(() => { ended += 1 })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(503, {}))

    await expect(authApi.refreshToken()).rejects.toThrow()

    expect(tokenStorage.getRefreshToken()).toBe('refresh-1')
    expect(ended).toBe(0)
    stop()
  })
})
