'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { authApi, AuthApiError } from '@/lib/auth-api'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Mail, Loader2 } from 'lucide-react'

export default function CheckEmailPage() {
  const { user } = useAuth()
  const [isResending, setIsResending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleResend = async () => {
    if (!user?.email) return

    setIsResending(true)
    setError('')
    setMessage('')

    try {
      const response = await authApi.resendVerification(user.email)
      setMessage(response.message || 'Verification email sent!')
    } catch (err) {
      if (err instanceof AuthApiError) {
        setError(err.message)
      } else {
        setError('Failed to resend verification email.')
      }
    } finally {
      setIsResending(false)
    }
  }

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center">
          <Mail className="h-8 w-8 text-blue-500" />
        </div>
        <CardTitle className="text-white">Check Your Email</CardTitle>
        <CardDescription className="text-gray-400">
          We&apos;ve sent a verification link to {user?.email || 'your email address'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-300 text-center">
          Click the link in the email to verify your account. If you don&apos;t see it, check your spam folder.
        </p>

        {message && (
          <Alert className="bg-green-900/20 border-green-800">
            <AlertDescription className="text-green-400">{message}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          variant="outline"
          className="w-full bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
          onClick={handleResend}
          disabled={isResending}
        >
          {isResending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Resending...
            </>
          ) : (
            'Resend Verification Email'
          )}
        </Button>
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-gray-400">
          Already verified?{' '}
          <Link href="/auth/login" className="text-blue-400 hover:underline">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
