'use client'

/**
 * Authentication context provider.
 *
 * Manages user authentication state and provides auth methods.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  AuthResponse,
  LoginCredentials,
  RegisterData,
  UpdateProfileData,
  User,
} from '@/lib/auth-types'
import { authApi, AuthApiError } from '@/lib/auth-api'
import { tokenStorage } from '@/lib/token-storage'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  login: (credentials: LoginCredentials) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (data: UpdateProfileData) => Promise<void>
  refreshUser: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const isAuthenticated = !!user

  /**
   * Try to restore session from refresh token on mount.
   */
  useEffect(() => {
    const initAuth = async () => {
      if (!tokenStorage.hasRefreshToken()) {
        setIsLoading(false)
        return
      }

      try {
        // Try to refresh the access token
        await authApi.refreshToken()
        // Fetch user profile
        const userData = await authApi.getMe()
        setUser(userData)
      } catch (err) {
        // Token refresh failed, clear tokens
        tokenStorage.clearTokens()
      } finally {
        setIsLoading(false)
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
          const errors: string[] = []
          if (err.data.email) errors.push(`Email: ${err.data.email.join(', ')}`)
          if (err.data.password) errors.push(`Password: ${err.data.password.join(', ')}`)
          if (err.data.password_confirm) errors.push(`Password confirmation: ${err.data.password_confirm.join(', ')}`)
          if (err.data.non_field_errors) errors.push(err.data.non_field_errors.join(', '))
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

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        error,
        login,
        register,
        logout,
        updateProfile,
        refreshUser,
        clearError,
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
