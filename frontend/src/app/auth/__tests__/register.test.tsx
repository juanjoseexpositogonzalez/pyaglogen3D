/**
 * The registration screen, migrated onto the design-system kit (issue #182,
 * slice 1 of 3).
 *
 * The frame, the chromeless route and the reason `PageHeader` is absent are
 * argued in `login.test.tsx`; this file does not restate them.
 *
 * Asserted through what a user can perceive and through the payload the API
 * receives. The payload is the sharp edge here: `handleChange` builds the form
 * state from `e.target.name`, so a field rendered without a `name` would look
 * right on screen and travel as a missing key.
 *
 * Two witnesses pin behaviour this migration found and was not allowed to
 * change:
 *   - `first_name` and `last_name` are optional and travel as empty strings,
 *     not as `undefined`, when left blank;
 *   - a mismatched confirmation is not caught here. The page submits and lets
 *     the API reject it, so the reader learns about the typo after a round trip.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRegister = vi.fn()
const mockClearError = vi.fn()
const mockGetOAuthUrl = vi.fn()

let mockAuthState: { error: string | null; isLoading: boolean } = {
  error: null,
  isLoading: false,
}

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    register: mockRegister,
    error: mockAuthState.error,
    clearError: mockClearError,
    isLoading: mockAuthState.isLoading,
  }),
}))

vi.mock('@/lib/auth-api', () => ({
  authApi: { getOAuthUrl: (provider: string) => mockGetOAuthUrl(provider) },
}))

import RegisterPage from '../register/page'

const form = () => document.querySelector('form') as HTMLFormElement

const renderPage = () => render(<RegisterPage />)

const tokensOf = (element: Element) => element.className.split(/\s+/)

const fill = (fields: Record<string, string>) => {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
}

const submit = async () => {
  await act(async () => {
    fireEvent.submit(form())
  })
}

beforeEach(() => {
  mockAuthState = { error: null, isLoading: false }
  mockRegister.mockResolvedValue(undefined)
  mockClearError.mockReset()
  mockGetOAuthUrl.mockImplementation((provider: string) => `https://api.test/oauth/${provider}`)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('registration screen', () => {
  it('names itself once at level two, inside a panel, with no main of its own', () => {
    const { container } = renderPage()

    // The shell owns `<main>`; on `/auth/*` its body is `display: contents`, so
    // this route supplies no landmark of its own either.
    expect(container.querySelector('main')).toBeNull()

    const surface = container.firstElementChild as HTMLElement
    expect(surface.tagName).toBe('SECTION')
    const tokens = tokensOf(surface)
    expect(tokens).toContain('border-line')
    expect(tokens).toContain('shadow-panel')
    expect(tokens).toContain('bg-surface-strong')
    expect(surface.contains(form())).toBe(true)

    const title = screen.getByRole('heading', { level: 2 })
    expect(title.textContent).toBe('Create Account')
    expect(surface.contains(title)).toBe(true)
    expect(screen.getByText('Sign up to start using PyAglogen3D')).toBeTruthy()
  })

  it('renders five labelled fields, and only three of them required', () => {
    renderPage()

    const expected = [
      ['First Name', 'first_name', 'text', 'John', false],
      ['Last Name', 'last_name', 'text', 'Doe', false],
      ['Email', 'email', 'email', 'your@email.com', true],
      ['Password', 'password', 'password', 'Create a strong password', true],
      ['Confirm Password', 'password_confirm', 'password', 'Confirm your password', true],
    ] as const

    for (const [label, name, type, placeholder, required] of expected) {
      const field = screen.getByLabelText(label) as HTMLInputElement
      expect(field.tagName, label).toBe('INPUT')
      expect(field.getAttribute('name'), label).toBe(name)
      expect(field.getAttribute('type'), label).toBe(type)
      expect(field.getAttribute('placeholder'), label).toBe(placeholder)
      expect(field.hasAttribute('required'), label).toBe(required)
      expect(field.value, label).toBe('')
    }

    expect(document.querySelectorAll('input')).toHaveLength(5)
  })

  it('paints the fields with kit tokens, and the merge drops the bridge ones', () => {
    renderPage()

    const email = screen.getByLabelText('Email') as HTMLInputElement
    const tokens = tokensOf(email)
    expect(tokens).toContain('text-ink')
    expect(tokens).toContain('border-line')
    expect(tokens).toContain('bg-surface')
    expect(tokens).toContain('placeholder:text-ink-faint')
    expect(tokens).not.toContain('border-input')
    expect(tokens).not.toContain('bg-background')
    expect(tokens).not.toContain('placeholder:text-muted-foreground')

    const labels = Array.from(document.querySelectorAll('label'))
    expect(labels).toHaveLength(5)
    for (const label of labels) {
      expect(tokensOf(label), label.textContent ?? '').toContain('text-ink')
    }
  })

  it('raises a registration failure as a danger alert, and only once one exists', () => {
    const { unmount } = renderPage()
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()

    // The context joins the field errors into one sentence; the page must show
    // that sentence whole rather than the first clause of it.
    mockAuthState = {
      error: 'Email: A user with this email already exists.; Password: Too short.',
      isLoading: false,
    }
    renderPage()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      'Email: A user with this email already exists.; Password: Too short.',
    )
    const tokens = tokensOf(alert)
    expect(tokens).toContain('border-danger')
    expect(tokens).toContain('bg-danger-soft')
  })

  it('sends every field of the form, keyed by name, after clearing a stale error', async () => {
    renderPage()

    fill({
      'First Name': 'Ana',
      'Last Name': 'Sosa',
      Email: 'ana@example.org',
      Password: 'secreto-123',
      'Confirm Password': 'secreto-123',
    })
    await submit()

    expect(mockRegister).toHaveBeenCalledWith({
      first_name: 'Ana',
      last_name: 'Sosa',
      email: 'ana@example.org',
      password: 'secreto-123',
      password_confirm: 'secreto-123',
    })
    expect(mockClearError.mock.invocationCallOrder[0]).toBeLessThan(
      mockRegister.mock.invocationCallOrder[0],
    )
  })

  it('sends the optional names as empty strings rather than omitting them', async () => {
    renderPage()

    fill({
      Email: 'ana@example.org',
      Password: 'secreto-123',
      'Confirm Password': 'secreto-123',
    })
    await submit()

    // Pinned, not wanted: `formData` always carries the five keys, so an empty
    // name travels as `''`. The API is what decides it means "no name".
    const payload = mockRegister.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'email',
      'first_name',
      'last_name',
      'password',
      'password_confirm',
    ])
    expect(payload.first_name).toBe('')
    expect(payload.last_name).toBe('')
  })

  it('does not catch a mismatched confirmation here; the API does', async () => {
    renderPage()

    fill({
      Email: 'ana@example.org',
      Password: 'secreto-123',
      'Confirm Password': 'secreto-124',
    })
    await submit()

    // Pinned, not wanted: nothing on this screen compares the two values, so
    // the typo costs a round trip and the reader only hears about it from the
    // server. Fixing it changes behaviour and needs its own approval.
    expect(mockRegister).toHaveBeenCalledWith({
      first_name: '',
      last_name: '',
      email: 'ana@example.org',
      password: 'secreto-123',
      password_confirm: 'secreto-124',
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves a rejected registration to the context: the page stays silent', async () => {
    mockRegister.mockRejectedValueOnce(new Error('400'))
    renderPage()

    fill({
      Email: 'ana@example.org',
      Password: 'secreto-123',
      'Confirm Password': 'secreto-123',
    })
    await submit()

    expect(mockRegister).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says it is creating the account while the request is in flight', () => {
    mockAuthState = { error: null, isLoading: true }
    renderPage()

    const pending = screen.getByRole('button', { name: /Creating account/ }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull()
  })

  it('points at the sign-in screen for someone who already has an account', () => {
    renderPage()

    expect(screen.getByText(/Already have an account\?/)).toBeTruthy()
    const link = screen.getByText('Sign in').closest('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/auth/login')
  })

  it('asks auth-api for the provider URL when an OAuth button is pressed', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Google/ }))
    fireEvent.click(screen.getByRole('button', { name: /GitHub/ }))

    expect(mockGetOAuthUrl.mock.calls).toEqual([['google'], ['github']])
    // The `window.location.assign` call that follows navigates nowhere this
    // jsdom can observe; see the same note in `login.test.tsx`.
  })

  it('carries no palette literal and no deprecated bridge utility', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    // Comments may legitimately name an old utility while explaining why it
    // left; only the live code is asserted against. Line endings are stripped
    // so a CRLF checkout measures the same as an LF one.
    const text = readFileSync(
      join(process.cwd(), 'src/app/auth/register/page.tsx'),
      'utf8',
    )
      .replace(/\r/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    const palette =
      /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/
    expect(text.match(palette)).toBeNull()
    expect(text).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(text).not.toMatch(/(?:rgba?|hsla?)\(\s*[\d.]/)

    for (const deprecated of [
      'text-muted-foreground',
      'bg-muted',
      'border-input',
      'text-foreground',
      'text-primary',
    ]) {
      expect(text).not.toMatch(new RegExp(`\\b${deprecated}\\b`))
    }

    expect(text).not.toMatch(/ui\/alert/)
    expect(text).not.toMatch(/ui\/card/)
    expect(text).toMatch(/@\/components\/kit\/Callout/)
    expect(text).toMatch(/@\/components\/kit\/Panel/)
  })

  it('tells a password manager which field is which', () => {
    // Without these, browsers and password managers cannot fill the first
    // screen of the product reliably, and on registration they cannot tell
    // the new password from its confirmation (issue #250).
    const { container } = render(<RegisterPage />)
    expect(container.querySelector("#first_name")?.getAttribute("autocomplete")).toBe("given-name")
    expect(container.querySelector("#last_name")?.getAttribute("autocomplete")).toBe("family-name")
    expect(container.querySelector("#email")?.getAttribute("autocomplete")).toBe("email")
    expect(container.querySelector("#password")?.getAttribute("autocomplete")).toBe("new-password")
    expect(container.querySelector("#password_confirm")?.getAttribute("autocomplete")).toBe("new-password")
  })
})
