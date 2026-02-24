'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authApi, AuthApiError } from '@/lib/auth-api'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setStatus('error')
        setMessage('No verification token provided.')
        return
      }

      try {
        const response = await authApi.verifyEmail(token)
        setStatus('success')
        setMessage(response.message || 'Email verified successfully!')
      } catch (err) {
        setStatus('error')
        if (err instanceof AuthApiError) {
          setMessage(err.message)
        } else {
          setMessage('Verification failed. Please try again.')
        }
      }
    }

    verifyEmail()
  }, [token])

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader className="text-center">
        <CardTitle className="text-white">Email Verification</CardTitle>
        <CardDescription className="text-gray-400">
          {status === 'loading' && 'Verifying your email address...'}
          {status === 'success' && 'Your email has been verified'}
          {status === 'error' && 'Verification failed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center py-8">
        {status === 'loading' && (
          <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />
        )}
        {status === 'success' && (
          <CheckCircle2 className="h-16 w-16 text-green-500" />
        )}
        {status === 'error' && (
          <XCircle className="h-16 w-16 text-red-500" />
        )}
        <p className="mt-4 text-gray-300 text-center">{message}</p>
      </CardContent>
      <CardFooter className="flex justify-center">
        {status === 'success' && (
          <Button asChild>
            <Link href="/auth/login">Continue to Login</Link>
          </Button>
        )}
        {status === 'error' && (
          <Button asChild variant="outline" className="bg-gray-700 border-gray-600 text-white">
            <Link href="/auth/login">Back to Login</Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function LoadingFallback() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader className="text-center">
        <CardTitle className="text-white">Email Verification</CardTitle>
        <CardDescription className="text-gray-400">
          Loading...
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center py-8">
        <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />
      </CardContent>
    </Card>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
