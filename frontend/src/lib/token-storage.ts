/**
 * Secure token storage for JWT authentication.
 *
 * Access tokens are stored in memory (more secure, cleared on page refresh).
 * Refresh tokens are stored in localStorage (persistent across sessions).
 * A marker cookie is set for middleware route protection.
 */

const REFRESH_TOKEN_KEY = 'pyaglogen3d_refresh_token'
const AUTH_COOKIE_NAME = 'pyaglogen3d_auth'

// In-memory storage for access token (more secure)
let accessToken: string | null = null

/**
 * Set a cookie for middleware auth detection.
 */
function setAuthCookie(value: boolean): void {
  if (typeof document === 'undefined') return
  if (value) {
    // Set cookie that expires in 7 days (matches refresh token)
    document.cookie = `${AUTH_COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
  } else {
    // Delete the cookie
    document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0`
  }
}

export const tokenStorage = {
  /**
   * Get the current access token from memory.
   */
  getAccessToken(): string | null {
    return accessToken
  },

  /**
   * Set the access token in memory.
   */
  setAccessToken(token: string | null): void {
    accessToken = token
  },

  /**
   * Get the refresh token from localStorage.
   */
  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  },

  /**
   * Set the refresh token in localStorage.
   */
  setRefreshToken(token: string | null): void {
    if (typeof window === 'undefined') return
    if (token) {
      localStorage.setItem(REFRESH_TOKEN_KEY, token)
      setAuthCookie(true)
    } else {
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      setAuthCookie(false)
    }
  },

  /**
   * Store both tokens at once.
   */
  setTokens(access: string, refresh: string): void {
    this.setAccessToken(access)
    this.setRefreshToken(refresh)
  },

  /**
   * Clear all tokens (logout).
   */
  clearTokens(): void {
    accessToken = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      setAuthCookie(false)
    }
  },

  /**
   * Check if user has a refresh token (potentially authenticated).
   */
  hasRefreshToken(): boolean {
    return !!this.getRefreshToken()
  },

  /**
   * Check if user has an access token (currently authenticated).
   */
  isAuthenticated(): boolean {
    return !!this.getAccessToken()
  },
}
