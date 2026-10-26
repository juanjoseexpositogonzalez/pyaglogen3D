/**
 * Paths the contract names but no test watched.
 *
 * An adversarial review proved each of these by mutation: breaking the code
 * left the whole suite green. A requirement with no witness is a sentence,
 * not a guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function freshModules() {
  vi.resetModules()
  const [authApiModule, apiModule, sessionEndModule, storageModule] = await Promise.all([
    import('../auth-api'),
    import('../api'),
    import('../session-end'),
    import('../token-storage'),
  ])
  return {
    authApi: authApiModule.authApi,
    api: apiModule,
    onSessionEnd: sessionEndModule.onSessionEnd,
    storage: storageModule.tokenStorage,
  }
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const refreshCalls = () =>
  (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
    String(url).includes('/auth/token/refresh/'),
  )

describe('paths the contract names', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks for no refresh at all when nothing is stored (R6)', async () => {
    const { api, storage, onSessionEnd } = await freshModules()
    storage.clearTokens()
    let ended = 0
    const stop = onSessionEnd(() => { ended += 1 })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(401))

    await expect(api.projectsApi.list()).rejects.toThrow()

    // An anonymous visitor must not be dragged through refresh coordination,
    // nor told a session they never had has ended.
    expect(refreshCalls()).toHaveLength(0)
    expect(ended).toBe(0)
    stop()
  })

  it('does not let an abandoned run wipe the next session slot (R5)', async () => {
    const { authApi, storage } = await freshModules()
    storage.setTokens('access-1', 'refresh-1')

    // Routed by URL, not by call order: sign-out issues its own request in
    // between, and a queue keyed on order hands it someone else's promise.
    const settlers: Array<(value: Response) => void> = []
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: unknown) => {
      if (String(url).includes('/auth/token/refresh/')) {
        return new Promise<Response>((resolve) => settlers.push(resolve))
      }
      return jsonResponse(200)
    })

    const abandoned = authApi.refreshToken().catch(() => null)
    await authApi.logout()

    // A new session, with its own refresh in flight.
    storage.setTokens('access-2', 'refresh-2')
    const current = authApi.refreshToken().catch(() => null)
    await Promise.resolve()

    // Issued now, not when the abandoned run settles. If sign-out left the
    // old slot in place, this call would silently join a refresh belonging to
    // a session that no longer exists, and the new session would be unable to
    // refresh until the old one finished.
    expect(refreshCalls()).toHaveLength(2)

    // The old run settles last. Releasing the slot unconditionally here would
    // clear the new session's slot, so the next caller would open a second
    // refresh presenting the same token — the collision this change removes.
    settlers[0](jsonResponse(200, { access: 'late', refresh: 'late' }))
    await abandoned

    const joined = authApi.refreshToken().catch(() => null)
    settlers[1](jsonResponse(200, { access: 'access-3', refresh: 'refresh-3' }))
    await Promise.all([current, joined])

    const bodies = refreshCalls().map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)).refresh,
    )
    expect(bodies).toEqual(['refresh-1', 'refresh-2'])
  })

  it('keeps credentials when the startup refresh hits a server error (T3.6)', async () => {
    const { authApi, storage, onSessionEnd } = await freshModules()
    storage.setTokens('access-1', 'refresh-1')
    let ended = 0
    const stop = onSessionEnd(() => { ended += 1 })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(503))

    await expect(authApi.refreshToken()).rejects.toThrow()

    // This is the path `AuthContext` walks on every page load. Discarding the
    // credential here is what made a server hiccup indistinguishable from a
    // revoked token.
    expect(storage.getRefreshToken()).toBe('refresh-1')
    expect(ended).toBe(0)
    stop()
  })
})
