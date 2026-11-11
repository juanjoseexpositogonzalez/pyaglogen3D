'use client'

/**
 * Authentication context provider.
 *
 * Manages user authentication state and provides auth methods.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  LoginCredentials,
  RegisterData,
  UpdateProfileData,
  User,
} from '@/lib/auth-types'
import { authApi, AuthApiError } from '@/lib/auth-api'
import { tokenStorage } from '@/lib/token-storage'

/**
 * How a field the API named is written to the reader.
 *
 * Only the fields this screen shows, plus a fallback: the server is the authority on
 * which fields exist, so an unlisted key is named by its own key rather than dropped
 * (#248 — the list used to be four keys long, and a refused `first_name` was silent).
 */
const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Password',
  password_confirm: 'Password confirmation',
  first_name: 'First name',
  last_name: 'Last name',
}

/**
 * Keys that are not fields, so they take no label.
 *
 * `detail`, `error`, `non_field_errors` and `messages` carry the sentence itself —
 * `authFetch` already reads the first two as the message when there is no field
 * error at all — and prefixing them turned `Token is invalid or expired` into
 * `Detail: Token is invalid or expired`.
 */
const UNLABELLED_KEYS = new Set(['detail', 'error', 'non_field_errors', 'messages'])

/**
 * Keys whose value is a machine token, not copy. SimpleJWT sends `code` beside a
 * refusal; showing it would put `token_not_valid` in front of a person.
 */
const MACHINE_KEYS = new Set(['code'])

/**
 * One sentence out of whatever shape DRF sends.
 *
 * An array of strings, a plain string (DRF wraps `detail` that way), or an array of
 * objects such as SimpleJWT's `messages`, where only the inner `message` is prose.
 * Anything that is not text is dropped rather than stringified: `[object Object]` is
 * not a sentence, and `formatApiError` already refuses the same shapes for the same
 * reason.
 */
const messageOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(messageOf).filter(Boolean).join(', ')
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.detail === 'string') return record.detail
    return Object.values(record).map(messageOf).filter(Boolean).join(', ')
  }
  return ''
}

const fieldLabel = (key: string) =>
  // `Object.hasOwn`, not a bare lookup: a key called `constructor` or `toString`
  // reads through the prototype and would put a native function in the alert.
  (Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key] : undefined) ??
  key.replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase())

interface AuthContextType {
  user: User | null
  /**
   * A request this context owns is in flight: the mount-time restore, a sign-in,
   * a registration or a logout.
   *
   * `updateProfile` and `refreshUser` deliberately do not raise it: `settings`
   * swaps its whole form for a full-screen loader on this flag, so raising it
   * around a save would take the form away mid-save.
   */
  isLoading: boolean
  /**
   * The context has not yet decided whether a session exists.
   *
   * True on the first render of every visitor, not only of a returning one: with
   * no stored token there is no restore to run, only a question that hasn't been
   * answered yet. So this flag is a reason not to claim anything (#246), never a
   * licence to say "restoring your session" — a first-time visitor has none.
   *
   * Separate from `isLoading` because on a returning reader's first render both
   * are true and they mean different things: the sign-in button read `isLoading`
   * alone and claimed a sign-in nobody sent. Additive on purpose — the route
   * guards read `isLoading` and keep reading exactly what they read before.
   */
  isRestoring: boolean
  isAuthenticated: boolean
  error: string | null
  login: (credentials: LoginCredentials) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (data: UpdateProfileData) => Promise<void>
  refreshUser: () => Promise<void>
  clearError: () => void
  handleOAuthCallback: (accessToken: string, refreshToken: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // True until the mount-time restore settles, with a token or without one.
  // `isLoading` keeps starting true as well: a route guard must not paint a
  // signed-out screen in the tick before the stored token is read.
  const [isRestoring, setIsRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const isAuthenticated = !!user

  /**
   * Try to restore session from refresh token on mount.
   */
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Reading the storage is itself a fallible operation: Safari in private
        // mode and "block all cookies" make `localStorage.getItem` throw a
        // SecurityError. Read outside this `try`, it escaped before the `finally`
        // and left both flags true for as long as the tab lived — the app behind
        // its loading gate and the sign-in button dead, saying "Sign In" with no
        // reason on the screen (#246).
        if (!tokenStorage.hasRefreshToken()) return

        // Try to refresh the access token
        await authApi.refreshToken()
        // Fetch user profile
        const userData = await authApi.getMe()
        setUser(userData)
      } catch (err) {
        // Deliberately does NOT discard the credentials. This runs on every
        // page load, so a 5xx or a dropped connection here used to log the
        // user out for a reason that says nothing about their credential.
        //
        // When the server really does reject the token, `auth-api` has
        // already cleared it and signalled the end of the session; there is
        // nothing left for this handler to decide.
      } finally {
        setIsLoading(false)
        setIsRestoring(false)
      }
    }

    initAuth()
  }, [])

  const login = useCallback(async (credentials: LoginCredentials) => {
    setError(null)
    setIsLoading(true)
    try {
      const response = await authApi.login(credentials)
      setUser(response.user)
      router.push('/dashboard')
    } catch (err) {
      if (err instanceof AuthApiError) {
        setError(err.message)
      } else {
        setError('Login failed. Please try again.')
      }
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [router])

  const register = useCallback(async (data: RegisterData) => {
    setError(null)
    setIsLoading(true)
    try {
      const response = await authApi.register(data)
      setUser(response.user)
      // Redirect to check-email page for verification
      router.push('/auth/check-email')
    } catch (err) {
      if (err instanceof AuthApiError) {
        // Format field errors
        if (err.data) {
          // Every key the server sent, in its order, not a fixed list of four.
          const errors: string[] = []
          for (const [field, value] of Object.entries(err.data)) {
            if (MACHINE_KEYS.has(field)) continue
            const messages = messageOf(value)
            if (messages === '') continue
            errors.push(UNLABELLED_KEYS.has(field) ? messages : `${fieldLabel(field)}: ${messages}`)
          }
          setError(errors.join('; ') || err.message)
        } else {
          setError(err.message)
        }
      } else {
        setError('Registration failed. Please try again.')
      }
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [router])

  const logout = useCallback(async () => {
    setIsLoading(true)
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setIsLoading(false)
      router.push('/auth/login')
    }
  }, [router])

  const updateProfile = useCallback(async (data: UpdateProfileData) => {
    setError(null)
    try {
      const updatedUser = await authApi.updateMe(data)
      setUser(updatedUser)
    } catch (err) {
      if (err instanceof AuthApiError) {
        setError(err.message)
      } else {
        setError('Profile update failed.')
      }
      throw err
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const userData = await authApi.getMe()
      setUser(userData)
    } catch (err) {
      // If we can't fetch user, they're probably logged out
      setUser(null)
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const handleOAuthCallback = useCallback(async (accessToken: string, refreshToken: string) => {
    // Store the tokens
    tokenStorage.setTokens(accessToken, refreshToken)

    // Fetch user profile
    try {
      const userData = await authApi.getMe()
      setUser(userData)
    } catch (err) {
      // If we can't fetch user, clear tokens
      tokenStorage.clearTokens()
      throw err
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isRestoring,
        isAuthenticated,
        error,
        login,
        register,
        logout,
        updateProfile,
        refreshUser,
        clearError,
        handleOAuthCallback,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
