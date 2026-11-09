/**
 * The email verification landing page, migrated onto the design-system kit
 * (issue #182, slice 2 of 3).
 *
 * Asserted through what a user can perceive — the sentence the page shows for
 * each state, the role that announces a failure, the destination and the tab
 * stops of the way out — rather than through which components were imported. A
 * test that checks imports passes a refactor that breaks the page.
 *
 * Two witnesses here do not describe behaviour the migration wanted; they pin
 * behaviour it found and was not allowed to change:
 *   - a page with no `token` in the URL never calls the API and says so
 *     itself;
 *   - the way out is one anchor, not a button inside an anchor. `Button`
 *     declares `asChild` and does not implement it, so the pre-migration page
 *     rendered `<button aschild="true">` around an `<a>`: invalid nesting and
 *     one destination with two tab stops. The `[aschild]` assertion is what
 *     fails if that primitive is ever adopted back into this page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyEmail, mockParams } = vi.hoisted(() => ({
  mockVerifyEmail: vi.fn(),
  mockParams: new Map<string, string>(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockParams.get(key) ?? null,
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => React.createElement('a', { href, ...rest }, children),
}))

// The real `AuthApiError` class is kept: the page narrows on `instanceof`, so a
// stub module would silently route every failure down the generic branch and
// make the "server reason is shown" witness unfalsifiable.
vi.mock('@/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-api')>('@/lib/auth-api')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      verifyEmail: (...args: unknown[]) => mockVerifyEmail(...args),
    },
  }
})

import VerifyEmailPage from '../verify-email/page'

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mockParams.clear()
  mockVerifyEmail.mockReset()
})

afterEach(() => {
  mockParams.clear()
})

describe('verify-email page', () => {
  it('names the screen with a second-level heading under the layout h1', () => {
    mockVerifyEmail.mockReturnValue(defer<{ message: string }>().promise)

    render(<VerifyEmailPage />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Email Verification' }),
    ).toBeTruthy()
  })

  it('verifies the token from the URL and reports the server message', async () => {
    mockParams.set('token', 'tok-abc')
    mockVerifyEmail.mockResolvedValue({ message: 'Address confirmed' })

    render(<VerifyEmailPage />)

    await waitFor(() => {
      expect(mockVerifyEmail).toHaveBeenCalledWith('tok-abc')
    })
    await waitFor(() => {
      expect(mockVerifyEmail.mock.calls.length).toBe(1)
    })
    expect(await screen.findByText('Address confirmed')).toBeTruthy()
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the progress sentence while the request is in flight', async () => {
    mockParams.set('token', 'tok-abc')
    const pending = defer<{ message: string }>()
    mockVerifyEmail.mockReturnValue(pending.promise)

    render(<VerifyEmailPage />)

    expect(screen.getByText('Verifying your email address...')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()

    pending.resolve({ message: 'Address confirmed' })
    await screen.findByText('Address confirmed')
  })

  it('falls back to its own confirmation when the server sends no message', async () => {
    mockParams.set('token', 'tok-abc')
    mockVerifyEmail.mockResolvedValue({ message: '' })

    render(<VerifyEmailPage />)

    expect(await screen.findByText('Email verified successfully!')).toBeTruthy()
  })

  it('announces the server reason when the token is rejected', async () => {
    const { AuthApiError } = await import('@/lib/auth-api')
    mockParams.set('token', 'expired-token')
    mockVerifyEmail.mockRejectedValue(new AuthApiError('Invalid or expired token', 400))

    render(<VerifyEmailPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid or expired token')
  })

  it('announces its own sentence when the failure is not an API error', async () => {
    mockParams.set('token', 'tok-abc')
    mockVerifyEmail.mockRejectedValue(new TypeError('network down'))

    render(<VerifyEmailPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Verification failed. Please try again.')
  })

  it('asks for a token instead of calling the API when the URL has none', async () => {
    render(<VerifyEmailPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No verification token provided.')
    expect(mockVerifyEmail).not.toHaveBeenCalled()
  })

  it('offers one login anchor on success, with no button wrapping it', async () => {
    mockParams.set('token', 'tok-abc')
    mockVerifyEmail.mockResolvedValue({ message: 'Address confirmed' })

    render(<VerifyEmailPage />)

    const link = await screen.findByRole('link', { name: 'Continue to Login' })
    expect(link.getAttribute('href')).toBe('/auth/login')
    expect(document.querySelectorAll('a[href="/auth/login"]').length).toBe(1)
    expect(document.querySelector('button')).toBeNull()
    expect(document.querySelector('[aschild]')).toBeNull()
  })

  it('offers the same single anchor as the way out of a failure', async () => {
    mockParams.set('token', 'expired-token')
    mockVerifyEmail.mockRejectedValue(new Error('boom'))

    render(<VerifyEmailPage />)

    const link = await screen.findByRole('link', { name: 'Back to Login' })
    expect(link.getAttribute('href')).toBe('/auth/login')
    expect(document.querySelectorAll('a[href="/auth/login"]').length).toBe(1)
    expect(document.querySelector('[aschild]')).toBeNull()
  })
})
