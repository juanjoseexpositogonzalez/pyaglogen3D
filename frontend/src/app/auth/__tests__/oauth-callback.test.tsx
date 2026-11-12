/**
 * The OAuth callback landing page, migrated onto the design-system kit
 * (issue #182, slice 2 of 3).
 *
 * This page's logic is the thing worth testing and the port was not allowed to
 * touch it, so the witnesses are its branches, in its order: provider error
 * before tokens, tokens stored and profile loaded before the dashboard
 * redirect, a failed exchange landing on `oauth_callback_failed`, and no
 * tokens at all landing on `missing_tokens`.
 *
 * The ordering witness matters on its own. `handleOAuthCallback` stores the
 * tokens and loads the profile; pushing `/dashboard` first would land the
 * dashboard on an unauthenticated session and bounce the visitor straight back
 * out.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPush, mockHandleOAuthCallback, mockParams, order } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHandleOAuthCallback: vi.fn(),
  mockParams: new Map<string, string>(),
  order: [] as string[],
}))

// A single stable object, the way Next returns one for a given URL. A fresh
// object per render would make the page's effect dependencies change on every
// render and turn a passing test into a hidden re-entrancy bug.
const stableSearchParams = {
  get: (key: string) => mockParams.get(key) ?? null,
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => stableSearchParams,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ handleOAuthCallback: mockHandleOAuthCallback }),
}))

import OAuthCallbackPage from '../oauth-callback/page'

/**
 * The tokens arrive in the URL **fragment** since #249: a fragment is never sent
 * to a server, so they stop reaching access logs and `Referer`. The query keeps
 * only `error`, which is not a secret.
 */
function setTokens(access: string, refresh: string) {
  window.location.hash = `#access=${encodeURIComponent(access)}&refresh=${encodeURIComponent(refresh)}`
}

beforeEach(() => {
  mockParams.clear()
  window.location.hash = ''
  order.length = 0
  mockPush.mockReset()
  mockPush.mockImplementation((url: string) => {
    order.push(`push:${url}`)
  })
  mockHandleOAuthCallback.mockReset()
  mockHandleOAuthCallback.mockImplementation(async () => {
    order.push('tokens')
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  mockParams.clear()
  window.location.hash = ''
  vi.restoreAllMocks()
})

describe('oauth-callback page', () => {
  it('stores the tokens from the URL, then lands on the dashboard', async () => {
    setTokens('access-123', 'refresh-456')

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(order).toEqual(['tokens', 'push:/dashboard'])
    })
    expect(mockHandleOAuthCallback).toHaveBeenCalledWith('access-123', 'refresh-456')
  })

  it('lets a provider error win over tokens that are also in the URL', async () => {
    mockParams.set('error', 'access_denied')
    setTokens('access-123', 'refresh-456')

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login?error=access_denied')
    })
    expect(mockHandleOAuthCallback).not.toHaveBeenCalled()
  })

  it('encodes a provider error so it cannot smuggle extra parameters', async () => {
    // `?error=a%26next%3D%2F%2Fevil.example` decodes to `a&next=//evil.example`.
    // Interpolated raw, the callback hands the login page a `next` parameter it
    // never wrote - and since #246 the login page reads that query, so this stops
    // being latent the moment it lands there.
    mockParams.set('error', 'a&next=//evil.example')

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/auth/login?error=' + encodeURIComponent('a&next=//evil.example')
      )
    })
    // And the raw form must NOT be what it pushed.
    expect(mockPush).not.toHaveBeenCalledWith(
      '/auth/login?error=a&next=//evil.example'
    )
  })

  it('sends a tokenless visit to the missing_tokens branch', async () => {
    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login?error=missing_tokens')
    })
    expect(mockHandleOAuthCallback).not.toHaveBeenCalled()
  })

  it('treats a half-delivered token pair as no tokens at all', async () => {
    window.location.hash = '#access=access-123'

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login?error=missing_tokens')
    })
    expect(mockHandleOAuthCallback).not.toHaveBeenCalled()
  })

  it('reports a failed token exchange instead of stranding the visitor', async () => {
    setTokens('access-123', 'refresh-456')
    mockHandleOAuthCallback.mockRejectedValue(new Error('profile unavailable'))

    render(<OAuthCallbackPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login?error=oauth_callback_failed')
    })
    expect(console.error).toHaveBeenCalled()
    expect(order).not.toContain('push:/dashboard')
  })

  it('announces the wait instead of leaving the screen silent', () => {
    setTokens('access-123', 'refresh-456')

    render(<OAuthCallbackPage />)

    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Completing sign in...')
  })
})
