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
    <Card className="bg-card border-border">
      <CardHeader className="text-center">
        <CardTitle className="text-foreground">Email Verification</CardTitle>
        <CardDescription className="text-muted-foreground">
          {status === 'loading' && 'Verifying your email address...'}
          {status === 'success' && 'Your email has been verified'}
          {status === 'error' && 'Verification failed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center py-8">
        {status === 'loading' && (
          <Loader2 className="h-16 w-16 text-primary animate-spin" />
        )}
        {status === 'success' && (
          <CheckCircle2 className="h-16 w-16 text-success" />
        )}
        {status === 'error' && (
          <XCircle className="h-16 w-16 text-destructive" />
        )}
        <p className="mt-4 text-foreground text-center">{message}</p>
      </CardContent>
      <CardFooter className="flex justify-center">
        {status === 'success' && (
          <Button asChild>
            <Link href="/auth/login">Continue to Login</Link>
          </Button>
        )}
        {status === 'error' && (
          <Button asChild variant="outline" className="bg-muted border-input text-foreground">
            <Link href="/auth/login">Back to Login</Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function LoadingFallback() {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="text-center">
        <CardTitle className="text-foreground">Email Verification</CardTitle>
        <CardDescription className="text-muted-foreground">
          Loading...
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center py-8">
        <Loader2 className="h-16 w-16 text-primary animate-spin" />
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
