'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

function OAuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { handleOAuthCallback } = useAuth()

  useEffect(() => {
    const processOAuth = async () => {
      const accessToken = searchParams.get('access')
      const refreshToken = searchParams.get('refresh')
      const error = searchParams.get('error')

      if (error) {
        router.push('/auth/login?error=' + error)
        return
      }

      if (accessToken && refreshToken) {
        try {
          // Store tokens and fetch user profile
          await handleOAuthCallback(accessToken, refreshToken)
          // Only redirect after tokens are stored and user is loaded
          router.push('/dashboard')
        } catch (err) {
          console.error('OAuth callback error:', err)
          router.push('/auth/login?error=oauth_callback_failed')
        }
      } else {
        // No tokens, redirect to login
        router.push('/auth/login?error=missing_tokens')
      }
    }

    processOAuth()
  }, [searchParams, router, handleOAuthCallback])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  )
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  )
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <OAuthCallbackContent />
    </Suspense>
  )
}
