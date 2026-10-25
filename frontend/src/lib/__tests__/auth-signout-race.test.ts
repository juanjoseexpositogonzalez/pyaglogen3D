/**
 * R5 — signing out cancels work already in flight.
 * R6 — an anonymous visitor triggers no refresh machinery.
 *
 * `logout()` clears the tokens in a `finally`, so during its own round trip
 * the refresh token is still readable. A refresh answering in that window —
 * or started in it — would write credentials back and restore the cookie the
 * route middleware reads, leaving the user signed in after asking to leave.
 *
 * Sharing one refresh between callers widens that window, so the change that
 * introduced the sharing has to close it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tokenStorage } from '../token-storage'

async function freshAuth() {
  vi.resetModules()
  const [authApiModule, sessionEndModule] = await Promise.all([
    import('../auth-api'),
    import('../session-end'),
  ])
  return { authApi: authApiModule.authApi, onSessionEnd: sessionEndModule.onSessionEnd }
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

async function flushUntil(condition: () => boolean, limit = 50): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (condition()) return
    await Promise.resolve()
  }
}

describe('sign-out versus a refresh in flight', () => {
  beforeEach(() => {
    tokenStorage.clearTokens()
    tokenStorage.setRefreshToken('refresh-1')
    global.fetch = vi.fn()
  })

  afterEach(() => {
    tokenStorage.clearTokens()
    vi.restoreAllMocks()
  })

  it('discards a refresh that answers after sign-out', async () => {
    const { authApi } = await freshAuth()

    let settleRefresh!: (value: Response) => void
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/auth/token/refresh/')) {
        return new Promise<Response>((resolve) => {
          settleRefresh = resolve
        })
      }
      return jsonResponse(200)
    })

    const refreshing = authApi.refreshToken().catch(() => null)
    await authApi.logout()

    settleRefresh(jsonResponse(200, { access: 'access-late', refresh: 'refresh-late' }))
    await refreshing
    await flushUntil(() => false, 10)

    // Writing the refresh token also restores the auth cookie, so a late
    // answer would put the user back inside the application.
    expect(tokenStorage.getRefreshToken()).toBeNull()
    expect(tokenStorage.getAccessToken()).toBeNull()
  })

  it('does not start a refresh once sign-out has begun', async () => {
    const { authApi } = await freshAuth()

    let settleLogout!: (value: Response) => void
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/auth/logout/')) {
        return new Promise<Response>((resolve) => {
          settleLogout = resolve
        })
      }
      return jsonResponse(200, { access: 'access-2', refresh: 'refresh-2' })
    })

    const loggingOut = authApi.logout()
    // The window the old code left open: the POST is travelling and the
    // refresh token is still sitting in storage.
    await expect(authApi.refreshToken()).rejects.toThrow()

    settleLogout(jsonResponse(200))
    await loggingOut

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/token/refresh/'),
    )
    expect(refreshCalls).toHaveLength(0)
  })

  it('asks for nothing when there is no stored token', async () => {
    const { authApi, onSessionEnd } = await freshAuth()
    let ended = 0
    const stop = onSessionEnd(() => { ended += 1 })

    tokenStorage.clearTokens()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(200))

    await expect(authApi.refreshToken()).rejects.toThrow()

    // An anonymous visitor must not be dragged through refresh coordination,
    // nor told their session ended: they never had one.
    expect(fetchMock.mock.calls).toHaveLength(0)
    expect(ended).toBe(0)
    stop()
  })
})
