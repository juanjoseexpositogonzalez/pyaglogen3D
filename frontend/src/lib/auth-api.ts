/**
 * Authentication API client.
 */

import type {
  AuthResponse,
  AuthError,
  ChangePasswordData,
  LoginCredentials,
  RegisterData,
  UpdateProfileData,
  User,
} from './auth-types'
import { endSession } from './session-end'
import { tokenStorage } from './token-storage'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

/**
 * The refresh in flight, shared by every caller that needs one.
 *
 * The access token lives in memory, so a full page load starts without one and
 * the screen's requests all receive 401 together. Without this slot each of
 * them asks for its own refresh with the same token; the server rotates and
 * blacklists, the first one wins, and the rest are rejected. Measured on the
 * project detail screen: five genuinely overlapping refreshes, and the session
 * destroyed in two loads out of eight.
 */
let refreshInFlight: Promise<{ access: string }> | null = null

/**
 * How long a caller waits for the shared refresh before giving up.
 *
 * Giving up is not cancelling: the request keeps running and the server may
 * well rotate the token. That is deliberate: the answer, if it arrives, is
 * stored, because discarding it would leave the client holding a credential
 * the server has already replaced, and the next attempt would fail for good.
 */
export const REFRESH_TIMEOUT_MS = 10_000

/** Rejects after the bound, leaving the underlying request to finish. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AuthApiError('Token refresh timed out', 408)),
      REFRESH_TIMEOUT_MS,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

class AuthApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: AuthError
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

async function authFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}/auth${endpoint}`

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  // Add auth header if we have an access token
  const accessToken = tokenStorage.getAccessToken()
  if (accessToken) {
    ;(headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let data: AuthError | undefined
    try {
      data = await response.json()
    } catch {
      // Ignore JSON parse errors
    }
    throw new AuthApiError(
      data?.error || data?.detail || `Request failed with status ${response.status}`,
      response.status,
      data
    )
  }

  return response.json()
}

export const authApi = {
  /**
   * Register a new user.
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await authFetch<AuthResponse>('/register/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    tokenStorage.setTokens(response.tokens.access, response.tokens.refresh)
    return response
  },

  /**
   * Login with email and password.
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await authFetch<AuthResponse>('/login/', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })
    tokenStorage.setTokens(response.tokens.access, response.tokens.refresh)
    return response
  },

  /**
   * Logout and blacklist the refresh token.
   */
  async logout(): Promise<void> {
    const refreshToken = tokenStorage.getRefreshToken()
    try {
      await authFetch('/logout/', {
        method: 'POST',
        body: JSON.stringify({ refresh: refreshToken }),
      })
    } finally {
      tokenStorage.clearTokens()
    }
  },

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshToken(): Promise<{ access: string }> {
    // Callers that arrive while a refresh is running await that one rather
    // than presenting the same token again.
    if (refreshInFlight) return withTimeout(refreshInFlight)

    const run = (async () => {
      // `allowRetry` is what bounds recovery to a single extra attempt: a
      // credential the server keeps rejecting has to end the session promptly
      // instead of looping.
      const attempt = async (allowRetry: boolean): Promise<{ access: string }> => {
        const presented = tokenStorage.getRefreshToken()
        if (!presented) {
          endSession()
          throw new AuthApiError('No refresh token available', 401)
        }

        const response = await fetch(`${API_URL}/auth/token/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: presented }),
        })

        if (!response.ok) {
          // Only the server saying "this credential is no good" can end a
          // session. A 5xx says the server is unwell, which is not the same
          // claim, and discarding credentials over it turns an outage into a
          // logout.
          const credentialRejected = response.status === 401 || response.status === 403
          if (!credentialRejected) {
            throw new AuthApiError('Token refresh failed', response.status)
          }

          // A rejection whose token has since been replaced in storage means
          // another refresh rotated it underneath this one: our own
          // concurrency, not a revoked credential. Retry with what is current.
          const current = tokenStorage.getRefreshToken()
          if (allowRetry && current && current !== presented) {
            return attempt(false)
          }

          tokenStorage.clearTokens()
          endSession()
          throw new AuthApiError('Token refresh failed', response.status)
        }

        const data = await response.json()
        tokenStorage.setAccessToken(data.access)

        // If we got a new refresh token (rotation enabled), save it
        if (data.refresh) {
          tokenStorage.setRefreshToken(data.refresh)
        }

        return data
      }

      // A transport failure never reaches the checks above, and must not:
      // the request never got an answer, so it says nothing about the
      // credential. It propagates with the credentials untouched.
      return attempt(true)
    })()

    // The slot holds the request itself, not the bounded wait: a caller whose
    // wait expires must not take the request down with it, because the server
    // may already have rotated the token.
    //
    // Released whether it succeeds or fails. A slot that is never released
    // would leave the context unable to refresh again, which is a worse
    // failure than the one being fixed.
    refreshInFlight = run.finally(() => {
      refreshInFlight = null
    })

    return withTimeout(refreshInFlight)
  },

  /**
   * Get the current user's profile.
   */
  async getMe(): Promise<User> {
    return authFetch<User>('/me/')
  },

  /**
   * Update the current user's profile.
   */
  async updateMe(data: UpdateProfileData): Promise<User> {
    return authFetch<User>('/me/', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  /**
   * Change the current user's password.
   */
  async changePassword(data: ChangePasswordData): Promise<{ message: string }> {
    return authFetch('/change-password/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * Verify email with token.
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    return authFetch('/verify-email/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  },

  /**
   * Resend verification email.
   */
  async resendVerification(email: string): Promise<{ message: string }> {
    return authFetch('/resend-verification/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  /**
   * Get OAuth login URL for a provider.
   */
  getOAuthUrl(provider: 'google' | 'github'): string {
    const baseUrl = API_URL.replace('/api/v1', '')
    return `${baseUrl}/accounts/${provider}/login/`
  },
}

export { AuthApiError }
