'use client'

/**
 * Email verification landing page, on the design-system kit (issue #182,
 * slice 2 of 3).
 *
 * No behaviour changed by the port: one request on mount keyed by the token
 * in the URL, the same three states, the same three sentences, the same two
 * destinations, and the same precedence of the server's own wording over the
 * built-in fallback.
 *
 * What the port changes, and why:
 *
 * 1. The shadcn `Card` becomes a `Panel`. The surface, the border and the
 *    shadow now come from the kit — `bg-surface-strong`, `border-line`,
 *    `shadow-panel` — instead of the `text-foreground` / `bg-muted` /
 *    `border-input` bridge. `Panel`'s title is an `h2`, which is the level the
 *    auth layout's `h1` asks for.
 * 2. The outcome sentence is a `Callout`, so a failure is announced
 *    (`role="alert"`) instead of being one more paragraph. Its text is
 *    unchanged: the server's reason when there is one, the built-in sentence
 *    otherwise.
 * 3. `Button asChild` is gone. `Button` declares `asChild` and does not
 *    implement it, so it reaches the DOM as `<button aschild="true">` around
 *    an `<a>`: invalid nesting, and one destination with two tab stops. A
 *    bare `Link` wearing `buttonVariants()` is what the compare screen and
 *    the batch summary already do. The primitive is still broken for every
 *    other caller — fixing it is not this slice's surface.
 * 4. The status icons are `aria-hidden`: each restates the hint and the
 *    sentence beside it, and a lucide glyph announces nothing usable on its
 *    own.
 *
 * The frame is deliberately not here. `<main>` in the shell is
 * `display: contents`, so the centring, the width and the padding come from
 * `app/auth/layout.tsx`; this page must not grow a second one.
 */
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'

import { authApi, AuthApiError } from '@/lib/auth-api'
import { buttonVariants } from '@/components/ui/button'
import { Callout } from '@/components/kit/Callout'
import { Panel } from '@/components/kit/Panel'

type Status = 'loading' | 'success' | 'error'

const HINTS: Record<Status, string> = {
  loading: 'Verifying your email address...',
  success: 'Your email has been verified',
  error: 'Verification failed',
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'loading') {
    return <Loader2 className="h-16 w-16 animate-spin text-brand" aria-hidden="true" />
  }
  if (status === 'success') {
    return <CheckCircle2 className="h-16 w-16 text-success" aria-hidden="true" />
  }
  return <XCircle className="h-16 w-16 text-danger" aria-hidden="true" />
}

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState<Status>('loading')
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
    <Panel
      title="Email Verification"
      hint={HINTS[status]}
      bodyClassName="flex flex-col items-center gap-4 py-8"
    >
      <StatusIcon status={status} />
      {message !== '' && (
        <Callout
          tone={status === 'error' ? 'danger' : 'success'}
          title={message}
          className="w-full"
        />
      )}
      {status === 'success' && (
        <Link href="/auth/login" className={buttonVariants()}>
          Continue to Login
        </Link>
      )}
      {status === 'error' && (
        <Link href="/auth/login" className={buttonVariants({ variant: 'outline' })}>
          Back to Login
        </Link>
      )}
    </Panel>
  )
}

function LoadingFallback() {
  return (
    <Panel
      title="Email Verification"
      hint="Loading..."
      bodyClassName="flex flex-col items-center gap-4 py-8"
    >
      <StatusIcon status="loading" />
    </Panel>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
