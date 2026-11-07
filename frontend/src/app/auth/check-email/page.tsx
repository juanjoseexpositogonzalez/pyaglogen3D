'use client'

/**
 * "Check your email" landing page, on the design-system kit (issue #182,
 * slice 2 of 3).
 *
 * No behaviour changed by the port: the same resend request with the
 * signed-in address, the same two messages, the same early return when there
 * is no address to send to, and the same disabled/busy control while the
 * resend is in flight.
 *
 * What the port changes, and why:
 *
 * 1. The shadcn `Card` becomes a `Panel`. The surface, the border and the
 *    shadow come from the kit (`bg-surface-strong`, `border-line`,
 *    `shadow-panel`) instead of the `bg-card` / `border-border` bridge, and
 *    `Panel`'s `h2` is the level the auth layout's `h1` asks for. The round
 *    avatar above the title becomes the icon inside the title: the kit has no
 *    header-avatar slot, and decoration does not earn a new primitive.
 * 2. The two shadcn `Alert`s become `Callout`s. The success notice keeps its
 *    tone and its words; the failure notice is `tone="danger"`, which carries
 *    `role="alert"`, so a failed resend is announced rather than rendered.
 * 3. The bridge utilities on the resend control (`bg-muted`, `border-input`,
 *    `text-foreground`) become `border-line`, `bg-surface`, `text-ink` and a
 *    `hover:bg-surface-soft`. `Button` and its variants are the shadcn
 *    primitive and stay as they are — overriding at the call site is the
 *    pattern every migrated screen uses.
 * 4. The sign-in link is `text-brand`, the kit's accent, instead of
 *    `text-primary`.
 *
 * The frame is deliberately not here: it comes from `app/auth/layout.tsx`,
 * because `<main>` in the shell is `display: contents`.
 *
 * Pinned behaviour this port found and was not allowed to change: with no
 * signed-in user the resend control is inert. `handleResend` returns before it
 * touches any state, so a click sends nothing, shows nothing, and leaves the
 * button enabled. The hint says "your email address" in that same breath. A
 * visitor who reaches this route directly gets a dead control with no
 * explanation; that is a behaviour fix, so it is reported rather than made.
 * The test file pins it, so a later slice has to invert it on purpose.
 */
import { useState } from 'react'
import Link from 'next/link'
import { Mail, Loader2 } from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import { authApi, AuthApiError } from '@/lib/auth-api'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/kit/Callout'
import { Panel } from '@/components/kit/Panel'

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
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Mail className="h-5 w-5 text-brand" aria-hidden="true" />
          Check Your Email
        </span>
      }
      hint={<>We&apos;ve sent a verification link to {user?.email || 'your email address'}</>}
      bodyClassName="space-y-4"
    >
      <p className="text-center text-sm text-ink">
        Click the link in the email to verify your account. If you don&apos;t see it, check your
        spam folder.
      </p>

      {message !== '' && <Callout tone="success" title={message} />}

      {error !== '' && <Callout tone="danger" title={error} />}

      <Button
        variant="outline"
        className="w-full border-line bg-surface text-ink hover:bg-surface-soft"
        onClick={handleResend}
        disabled={isResending}
      >
        {isResending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Resending...
          </>
        ) : (
          'Resend Verification Email'
        )}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        Already verified?{' '}
        <Link href="/auth/login" className="text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </Panel>
  )
}
