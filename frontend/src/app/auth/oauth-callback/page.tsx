'use client'

/**
 * OAuth callback landing page, on the design-system kit (issue #182, slice 2
 * of 3).
 *
 * The logic is deliberately untouched, down to the order of the branches and
 * the exact URL each one pushes: a provider `error` wins over tokens, present
 * tokens are stored and the profile is loaded before the dashboard redirect,
 * a failed load clears the tokens and falls back to
 * `?error=oauth_callback_failed`, and no tokens at all is
 * `?error=missing_tokens`. The `console.error` stays. Anything that only
 * looked like a design change to this screen would have been a chase of the
 * wrong surface: it has no literals and no bridge utilities beyond
 * `text-muted-foreground` and `border-primary`.
 *
 * What the port changes:
 *
 * 1. The two spinner blocks were byte-identical apart from their label, so
 *    they are now one `Authenticating` component. The labels are the same
 *    words they always were.
 * 2. `text-muted-foreground` is `text-ink-muted` and `border-primary` is
 *    `border-brand`, the kit's accent, so the screen stops depending on the
 *    shadcn bridge.
 * 3. The block is a live region (`role="status"`). It is the only thing on
 *    screen while the tokens are being exchanged, and nothing announced it
 *    before: a screen-reader user was left on a page that looked empty until
 *    the redirect arrived.
 *
 * The `min-h-screen` centring stays even though `app/auth/layout.tsx` already
 * centres. That is a real double frame and it is not this slice's to remove:
 * the shell's `<main>` is `display: contents`, and the frame this route owns
 * is part of its contract until the layout takes it back.
 *
 * Reported, not fixed — this file handles tokens that arrive in the URL:
 *   - `access` and `refresh` land in the query string, so they reach browser
 *     history, any access log on the way, and the `Referer` of any
 *     third-party subresource loaded before the redirect. A fragment or a
 *     one-time server-side code would not. That is an auth-flow decision.
 *   - ~~`'/auth/login?error=' + error` copies the provider's `error` value into
 *     a URL without `encodeURIComponent`~~ **fixed in #249**: the value is encoded,
 *     so `?error=a%26next%3D%2F%2Fevil` arrives as one parameter and cannot add one.
 *   - none of those three `?error=` values is read by the login page, which
 *     takes its message from `AuthContext` and never looks at the query. A
 *     failed OAuth sign-in therefore lands on a blank login form with no
 *     explanation. Fixing it belongs to the login screen (slice 1), not here.
 */
import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

function Authenticating({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center" role="status">
        <div
          className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-brand"
          aria-hidden="true"
        />
        <p className="text-ink-muted">{label}</p>
      </div>
    </div>
  )
}

function OAuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { handleOAuthCallback } = useAuth()

  useEffect(() => {
    const processOAuth = async () => {
      // The tokens arrive in the URL **fragment** (#249): a fragment is never
      // sent to a server, so they stop reaching access logs and `Referer`.
      // `error` stays on the query because it is not a secret and the login
      // page reads it there.
      const hashParams = new URLSearchParams(
        window.location.hash.replace(/^#/, '')
      )
      const accessToken = hashParams.get('access')
      const refreshToken = hashParams.get('refresh')
      const error = searchParams.get('error')

      if (error) {
        // `encodeURIComponent`: a provider error like `a&next=//evil.example`
        // would otherwise arrive as two parameters, and the login page reads the
        // query since #246 - so the callback would hand it one it never wrote
        // (#249).
        router.push('/auth/login?error=' + encodeURIComponent(error))
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

  return <Authenticating label="Completing sign in..." />
}

function LoadingFallback() {
  return <Authenticating label="Loading..." />
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <OAuthCallbackContent />
    </Suspense>
  )
}
