/**
 * R4 applied where the symptom is produced.
 *
 * Classifying the failure inside `auth-api` is not enough: `api.ts` reacts to
 * a 401 in TWO places, and both end the session whenever `tryRefreshToken()`
 * returns false — which it does for every error, recoverable or not. Fixing
 * one path and leaving the other is the defect reachable by another route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tokenStorage } from '../token-storage'

async function freshApi() {
  vi.resetModules()
  const [apiModule, sessionEndModule] = await Promise.all([
    import('../api'),
    import('../session-end'),
  ])
  return { api: apiModule, onSessionEnd: sessionEndModule.onSessionEnd }
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('401 handling does not expel on recoverable failures', () => {
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

  it('keeps the session when the refresh fails with a server error', async () => {
    const { api, onSessionEnd } = await freshApi()
    const stop = onSessionEnd(() => { ended += 1 })

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes('/auth/token/refresh/')
        ? jsonResponse(503)
        : jsonResponse(401),
    )

    await expect(api.projectsApi.list()).rejects.toThrow()

    // The server being unwell is not the server revoking a credential.
    expect(ended).toBe(0)
    expect(tokenStorage.getRefreshToken()).toBe('refresh-1')
    stop()
  })

  it('keeps the session when the refresh fails at transport level', async () => {
    const { api, onSessionEnd } = await freshApi()
    const stop = onSessionEnd(() => { ended += 1 })

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/auth/token/refresh/')) throw new TypeError('Failed to fetch')
      return jsonResponse(401)
    })

    await expect(api.projectsApi.list()).rejects.toThrow()

    expect(ended).toBe(0)
    expect(tokenStorage.getRefreshToken()).toBe('refresh-1')
    stop()
  })

  it('ends the session when the credential is actually rejected', async () => {
    const { api, onSessionEnd } = await freshApi()
    const stop = onSessionEnd(() => { ended += 1 })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(401))

    await expect(api.projectsApi.list()).rejects.toThrow()

    expect(ended).toBe(1)
    stop()
  })
})
