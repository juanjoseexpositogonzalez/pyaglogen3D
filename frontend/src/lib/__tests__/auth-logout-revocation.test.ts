/**
 * Signing out must actually revoke the refresh token on the server.
 *
 * This guard exists because the change that invalidates credentials on the
 * way into `logout()` broke it: clearing the access token first meant the
 * request went out unauthenticated, the server answered 401, and
 * `token.blacklist()` never ran — leaving the refresh token usable for its
 * full seven-day lifetime after the user signed out. The failure was silent,
 * swallowed by the handler that ignores logout errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function freshAuth() {
  vi.resetModules()
  const [authApiModule, storageModule] = await Promise.all([
    import('../auth-api'),
    import('../token-storage'),
  ])
  return { authApi: authApiModule.authApi, storage: storageModule.tokenStorage }
}

function logoutCall() {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
    String(url).includes('/auth/logout/'),
  )
}

describe('sign-out revokes the credential on the server', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the access token so the server will accept the revocation', async () => {
    const { authApi, storage } = await freshAuth()
    storage.setTokens('access-1', 'refresh-1')

    await authApi.logout()

    const call = logoutCall()
    expect(call).toBeDefined()
    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string>
    expect(headers?.Authorization).toBe('Bearer access-1')
  })

  it('sends the refresh token that has to be blacklisted', async () => {
    const { authApi, storage } = await freshAuth()
    storage.setTokens('access-1', 'refresh-1')

    await authApi.logout()

    const body = JSON.parse(String((logoutCall()?.[1] as RequestInit).body))
    expect(body.refresh).toBe('refresh-1')
  })

  it('still clears the local session when the server refuses', async () => {
    const { authApi, storage } = await freshAuth()
    storage.setTokens('access-1', 'refresh-1')
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('offline'))

    await authApi.logout()

    // Failing to tell the server is not a reason to keep the user signed in.
    expect(storage.getRefreshToken()).toBeNull()
    expect(storage.getAccessToken()).toBeNull()
  })
})
