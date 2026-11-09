/**
 * The "check your email" landing page, migrated onto the design-system kit
 * (issue #182, slice 2 of 3).
 *
 * Asserted through what a user can perceive — the address the page says it
 * wrote to, the notice each outcome raises, the busy state of the resend
 * control — rather than through which components were imported.
 *
 * The behaviour is the contract here, not only the paint: the address that
 * travels is the signed-in one, the server's own message wins over the
 * built-in one, and a resend in flight disables its own control.
 *
 * One witness does not describe behaviour the migration wanted; it pins
 * behaviour it found and was not allowed to change: with no signed-in user the
 * resend control is inert. It sends nothing, shows nothing, and does not even
 * disable itself. A later slice has to invert that on purpose.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResendVerification, auth } = vi.hoisted(() => ({
  mockResendVerification: vi.fn(),
  auth: { user: null as { email: string } | null },
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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user }),
}))

// The real `AuthApiError` class is kept: the page narrows on `instanceof`.
vi.mock('@/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-api')>('@/lib/auth-api')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      resendVerification: (...args: unknown[]) => mockResendVerification(...args),
    },
  }
})

import CheckEmailPage from '../check-email/page'

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
  auth.user = { email: 'ada@example.com' }
  mockResendVerification.mockReset()
})

afterEach(() => {
  auth.user = null
})

describe('check-email page', () => {
  it('names the screen with a second-level heading under the layout h1', () => {
    render(<CheckEmailPage />)

    expect(screen.getByRole('heading', { level: 2, name: 'Check Your Email' })).toBeTruthy()
  })

  it('tells the visitor which address the link went to', () => {
    render(<CheckEmailPage />)

    expect(screen.getByText(/verification link to ada@example\.com/)).toBeTruthy()
  })

  it('says "your email address" when nobody is signed in', () => {
    auth.user = null

    render(<CheckEmailPage />)

    expect(screen.getByText(/verification link to your email address/)).toBeTruthy()
  })

  it('resends to the signed-in address and reports the server message', async () => {
    mockResendVerification.mockResolvedValue({ message: 'Sent again' })

    render(<CheckEmailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    await waitFor(() => {
      expect(mockResendVerification).toHaveBeenCalledWith('ada@example.com')
    })
    expect(await screen.findByText('Sent again')).toBeTruthy()
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to its own confirmation when the server sends no message', async () => {
    mockResendVerification.mockResolvedValue({ message: '' })

    render(<CheckEmailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    expect(await screen.findByText('Verification email sent!')).toBeTruthy()
  })

  it('announces the server reason when the resend is rejected', async () => {
    const { AuthApiError } = await import('@/lib/auth-api')
    mockResendVerification.mockRejectedValue(
      new AuthApiError('Too many requests, try again in a minute', 429),
    )

    render(<CheckEmailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Too many requests, try again in a minute')
  })

  it('announces its own sentence when the failure is not an API error', async () => {
    mockResendVerification.mockRejectedValue(new TypeError('network down'))

    render(<CheckEmailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Failed to resend verification email.')
  })

  it('disables its own control and says it is resending', async () => {
    const pending = defer<{ message: string }>()
    mockResendVerification.mockReturnValue(pending.promise)

    render(<CheckEmailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    const busy = await screen.findByRole('button', { name: 'Resending...' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)

    pending.resolve({ message: 'Sent again' })
    await screen.findByText('Sent again')
    const resting = screen.getByRole('button', { name: 'Resend Verification Email' })
    expect((resting as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends nothing and says nothing when nobody is signed in', async () => {
    auth.user = null

    render(<CheckEmailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend Verification Email' }))

    await waitFor(() => {
      expect(mockResendVerification).not.toHaveBeenCalled()
    })
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Resend Verification Email' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('points the sign-in path at the login route with one tab stop', () => {
    render(<CheckEmailPage />)

    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/auth/login')
    expect(document.querySelectorAll('a[href="/auth/login"]').length).toBe(1)
    expect(document.querySelector('[aschild]')).toBeNull()
  })
})
