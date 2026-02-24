'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

function OAuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { handleOAuthCallback } = useAuth()

  useEffect(() => {
    const accessToken = searchParams.get('access')
    const refreshToken = searchParams.get('refresh')
    const error = searchParams.get('error')

    if (error) {
      router.push('/auth/login?error=' + error)
      return
    }

    if (accessToken && refreshToken) {
      // Store tokens and redirect to dashboard
      handleOAuthCallback(accessToken, refreshToken)
      router.push('/dashboard')
    } else {
      // No tokens, redirect to login
      router.push('/auth/login?error=missing_tokens')
    }
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
