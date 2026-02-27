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
import { tokenStorage } from './token-storage'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

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
    const refreshToken = tokenStorage.getRefreshToken()
    if (!refreshToken) {
      throw new AuthApiError('No refresh token available', 401)
    }

    const response = await fetch(`${API_URL}/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    })

    if (!response.ok) {
      tokenStorage.clearTokens()
      throw new AuthApiError('Token refresh failed', response.status)
    }

    const data = await response.json()
    tokenStorage.setAccessToken(data.access)

    // If we got a new refresh token (rotation enabled), save it
    if (data.refresh) {
      tokenStorage.setRefreshToken(data.refresh)
    }

    return data
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
