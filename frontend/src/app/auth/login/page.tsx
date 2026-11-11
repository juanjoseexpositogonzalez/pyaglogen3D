'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { authApi } from '@/lib/auth-api'
import { Callout } from '@/components/kit/Callout'
import { Panel } from '@/components/kit/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

/**
 * The sign-in form, on the design-system kit.
 *
 * This screen carried no colour literal before this change — that wave was
 * earlier — and no token utility either. What it carried was the shadcn
 * bridge: `text-foreground`, `text-muted-foreground`, `bg-muted`,
 * `border-input`. Those are not the kit, so they are gone and the tokens
 * replace them.
 *
 * The frame is not here and must not be added here: `/auth/*` is chromeless by
 * pathname, so the shell's `<main>` is `display: contents` and supplies no
 * gutter, no rail and no top bar. `auth/layout.tsx` is the frame — full height,
 * centred, capped at 448px — and it is the only one these routes get.
 *
 * `PageHeader` is deliberately absent. It renders its own `<h1>`, and the frame
 * already names the product at that level; two level-one headings on a
 * centred card would leave a reader moving by headings with no way to tell
 * them apart. `Panel` supplies the level-two title the form hangs off instead.
 *
 * `Callout` replaces `Alert`: it keeps the `role="alert"` that made a failed
 * sign-in audible, and adds the icon that keeps the state readable in
 * greyscale. The message is the auth context's, verbatim — this file writes no
 * copy of its own for a rejection.
 *
 * Nothing below the paint moves: the two fields, their types, placeholders and
 * `required` flags, the clear-then-submit order, the pending copy, the OAuth
 * round trip through `authApi.getOAuthUrl`, and the landing page after a
 * successful sign-in (owned by `AuthContext`, which pushes to `/dashboard`).
 */

/**
 * `Input` and `Button` still ship the bridge colours. `cn` runs
 * tailwind-merge, so the token passed here displaces the one underneath
 * instead of stacking beside it; the field or button keeps a single
 * background, border and text colour.
 */
const FIELD = 'border-line bg-surface text-ink placeholder:text-ink-faint'
const OUTLINE_BUTTON = 'border-line bg-surface text-ink hover:bg-surface-soft'

/**
 * Hand the browser to the provider.
 *
 * The address comes from `authApi.getOAuthUrl`, which builds it from the
 * deployment's own API base plus the provider literal below — never from a
 * value a visitor supplies. It is written as `location.assign` because that is
 * what an `href` assignment does, spelled as one call with one argument, and
 * because the destination is then a parameter of the navigation rather than a
 * value pasted next to it.
 */
function startOAuth(provider: 'google' | 'github') {
  window.location.assign(authApi.getOAuthUrl(provider))
}

export default function LoginPage() {
  const { login, error, clearError, isLoading, isRestoring } = useAuth()

  /*
    Two facts, two sentences (#246). `isRestoring` is true while the context
    looks for a session behind a stored refresh token: nothing has been
    submitted, so the button keeps the idle copy even though a request is in
    flight. `submitting` is a sign-in this form actually sent. The button is
    unpressable in both — there is nothing to send until the context knows
    whether a session exists — but it narrates only the second.
  */
  const submitting = isLoading && !isRestoring

  /*
    The OAuth callback writes `?error=` into this route when the provider
    refuses, and until now nobody read it: a failed sign-in landed on a blank
    form with no word of why. The value arrives from our own callback, but it
    reaches this page through the query string, so it is read once and rendered
    as text — never as markup.
  */
  const [providerError, setProviderError] = useState<string | null>(null)
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('error')
    if (reason) setProviderError(reason)
  }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    try {
      await login({ email, password })
    } catch {
      // Error is handled by context
    }
  }

  return (
    <Panel title="Sign In" hint="Enter your credentials to access your account">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <Callout tone="danger" title={error} />
        ) : (
          providerError && (
            <Callout
              tone="danger"
              title={
                providerError === 'access_denied'
                  ? 'The provider did not grant access, so you are not signed in.'
                  : `Sign-in failed: ${providerError}`
              }
            />
          )
        )}

        <div className="space-y-2">
          <Label htmlFor="email" className="text-ink">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={FIELD}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-ink">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={FIELD}
          />
        </div>

        <Button type="submit" className="w-full" disabled={isRestoring || isLoading}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </Button>

        {/*
          The rule and the word that interrupts it. The mask matches the panel
          surface underneath, which is what makes the line stop at the text
          instead of running through it.
        */}
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-surface-strong px-2 text-ink-muted">Or continue with</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button
            type="button"
            variant="outline"
            className={OUTLINE_BUTTON}
            onClick={() => startOAuth('google')}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google
          </Button>
          <Button
            type="button"
            variant="outline"
            className={OUTLINE_BUTTON}
            onClick={() => startOAuth('github')}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </Button>
        </div>

        <p className="text-center text-sm text-ink-muted">
          Don&apos;t have an account?{' '}
          <Link href="/auth/register" className="text-brand hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </Panel>
  )
}
