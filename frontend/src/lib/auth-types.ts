/**
 * TypeScript types for authentication.
 */

export interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  email_verified: boolean
  is_staff: boolean
  avatar_url: string | null
  oauth_provider: 'google' | 'github' | ''
  created_at: string
}

export interface AuthTokens {
  access: string
  refresh: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData {
  email: string
  password: string
  password_confirm: string
  first_name?: string
  last_name?: string
}

export interface AuthResponse {
  user: User
  tokens: AuthTokens
  message?: string
}

export interface AuthError {
  error?: string
  detail?: string
  email?: string[]
  password?: string[]
  password_confirm?: string[]
  non_field_errors?: string[]
}

export interface ChangePasswordData {
  old_password: string
  new_password: string
}

export interface UpdateProfileData {
  first_name?: string
  last_name?: string
  avatar_url?: string
}
