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

/**
 * Thrown when the browser refuses `localStorage` (#302).
 *
 * Safari private mode and "block all cookies" make `localStorage` **throw** a
 * `SecurityError` on access instead of returning null. Swallowing it left the cause
 * invisible: a successful login answered 200 and then died in `setTokens`, and the
 * caller reported it as a wrong credential.
 */
export class StorageBlockedError extends Error {
  constructor() {
    super('the browser is blocking local storage')
    this.name = 'StorageBlockedError'
  }
}

/** Write a probe key and remove it: the only reliable way to know. */
function probeStorage(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const key = '__pyaglogen3d_storage_probe__'
    window.localStorage.setItem(key, '1')
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export const tokenStorage = {
  /** Whether this browser will let us keep a session at all (#302). */
  isAvailable: probeStorage,
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
    try {
      if (token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, token)
        setAuthCookie(true)
      } else {
        localStorage.removeItem(REFRESH_TOKEN_KEY)
        setAuthCookie(false)
      }
    } catch {
      // #302: named, so the caller can say *this* instead of blaming credentials.
      throw new StorageBlockedError()
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
