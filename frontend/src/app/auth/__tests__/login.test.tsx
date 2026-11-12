/**
 * The sign-in screen and the frame it shares with registration, migrated onto
 * the design-system kit (issue #182, slice 1 of 3).
 *
 * These routes are chromeless by pathname: `isChromeless` in the shell returns
 * true for `/auth/*`, so the shell's `<main>` is `display: contents` and the
 * gutter, the rail and the top bar are all absent. The frame therefore belongs
 * to `auth/layout.tsx` and must stay there. Several assertions below exist only
 * to stop a later slice from deleting it "for consistency" with the nine
 * screens where the shell supplies the frame.
 *
 * Asserted through what a user can perceive — heading levels, accessible
 * names, the roles that carry state, the payload the API receives — rather
 * than through which components were imported. A test that checks imports
 * passes a refactor that breaks the page.
 *
 * Two witnesses here do not describe behaviour this migration wanted; they pin
 * behaviour it found and was not allowed to change:
 *   - a rejected `login` renders no message of its own: the `catch` is empty
 *     and the copy comes from the auth context;
 *   - the OAuth button navigates with a raw `window.location.assign` call,
 *     which this jsdom cannot observe (see the test).
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogin = vi.fn()
const mockClearError = vi.fn()
const mockGetOAuthUrl = vi.fn()

// Mutable on purpose: the page reads the context on every render, so flipping
// these between renders is how the error and pending branches are reached.
//
// `isLoading` and `isRestoring` are two different facts (#246). The context sets
// both on a returning reader's first render — it is restoring a stored session
// *and* has a request in flight — and only `isLoading` alone on a sign-in this
// form sent.
let mockAuthState: {
  error: string | null
  isLoading: boolean
  isRestoring: boolean
} = {
  error: null,
  isLoading: false,
  isRestoring: false,
}

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    error: mockAuthState.error,
    clearError: mockClearError,
    isLoading: mockAuthState.isLoading,
    isRestoring: mockAuthState.isRestoring,
  }),
}))

vi.mock('@/lib/auth-api', () => ({
  authApi: { getOAuthUrl: (provider: string) => mockGetOAuthUrl(provider) },
}))

import LoginPage from '../login/page'
import AuthLayout from '../layout'

const form = () => document.querySelector('form') as HTMLFormElement

const renderPage = () => render(<LoginPage />)
const renderInFrame = () => render(<AuthLayout><LoginPage /></AuthLayout>)

const tokensOf = (element: Element) => element.className.split(/\s+/)

const submit = async () => {
  await act(async () => {
    fireEvent.submit(form())
  })
}

beforeEach(() => {
  mockAuthState = { error: null, isLoading: false, isRestoring: false }
  mockLogin.mockResolvedValue(undefined)
  mockClearError.mockReset()
  mockGetOAuthUrl.mockImplementation((provider: string) => `https://api.test/oauth/${provider}`)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('sign-in screen', () => {
  it('draws no main of its own: the route is chromeless and the layout is the frame', () => {
    const { container } = renderInFrame()

    // The shell owns `<main>`. A second one on the route gives the document two
    // main landmarks and makes the skip link land on the inner one.
    expect(container.querySelector('main')).toBeNull()

    const frame = container.firstElementChild as HTMLElement
    const tokens = tokensOf(frame)
    // The frame the shell would otherwise supply: full height, centred, and a
    // capped column. On `/auth/*` nothing else provides any of this.
    expect(tokens).toContain('min-h-screen')
    expect(tokens).toContain('items-center')
    expect(tokens).toContain('justify-center')
    expect(tokens).toContain('px-4')

    const column = frame.firstElementChild as HTMLElement
    expect(tokensOf(column)).toContain('max-w-md')
    expect(tokensOf(column)).not.toContain('container')
    // The form lives inside that one column, under the product title.
    expect(column.contains(form())).toBe(true)
  })

  it('names the product once, at level one, and the form once, at level two', () => {
    renderInFrame()

    const product = screen.getAllByRole('heading', { level: 1 })
    expect(product).toHaveLength(1)
    expect(product[0].textContent).toBe('PyAglogen3D')
    expect(screen.getByText('3D Agglomerate Simulation Platform')).toBeTruthy()

    // `PageHeader` is deliberately absent: it renders an `<h1>` of its own, and
    // on a centred sign-in card that would be a second level-one heading with
    // nothing to distinguish it from the product name above.
    const section = screen.getByRole('heading', { level: 2 })
    expect(section.textContent).toBe('Sign In')
  })

  it('sits the form in a titled panel carrying kit surface tokens', () => {
    const { container } = renderPage()

    const surface = container.firstElementChild as HTMLElement
    expect(surface.tagName).toBe('SECTION')
    const tokens = tokensOf(surface)
    expect(tokens).toContain('border-line')
    expect(tokens).toContain('shadow-panel')
    expect(tokens).toContain('bg-surface-strong')
    expect(surface.contains(form())).toBe(true)
    expect(surface.contains(screen.getByRole('heading', { level: 2 }))).toBe(true)

    // The one line under the title stays, and stays muted: it is the only copy
    // telling a first-time visitor what the field pair is for.
    const hint = screen.getByText('Enter your credentials to access your account')
    expect(tokensOf(hint)).toContain('hint')
  })

  it('labels both fields and keeps each one its type, placeholder and requirement', () => {
    renderPage()

    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect(email.tagName).toBe('INPUT')
    expect(email.getAttribute('type')).toBe('email')
    expect(email.getAttribute('placeholder')).toBe('your@email.com')
    expect(email.hasAttribute('required')).toBe(true)
    expect(email.value).toBe('')
    // #250: the attribute a password manager reads. Without it a manager cannot
    // tell the credential pair from any other pair of boxes on the page, and the
    // failure is silent — the form still works for anyone who types.
    expect(email.getAttribute('autocomplete')).toBe('email')

    const password = screen.getByLabelText('Password') as HTMLInputElement
    expect(password.tagName).toBe('INPUT')
    expect(password.getAttribute('type')).toBe('password')
    expect(password.getAttribute('placeholder')).toBe('Your password')
    expect(password.hasAttribute('required')).toBe(true)
    expect(password.value).toBe('')
    expect(password.getAttribute('autocomplete')).toBe('current-password')

    // No third field: this form asks for a credential pair and nothing else.
    expect(document.querySelectorAll('input')).toHaveLength(2)
  })

  it('paints the fields with kit tokens, and the merge drops the bridge ones', () => {
    renderPage()

    const email = screen.getByLabelText('Email') as HTMLInputElement
    const tokens = tokensOf(email)
    expect(tokens).toContain('text-ink')
    expect(tokens).toContain('border-line')
    expect(tokens).toContain('bg-surface')
    expect(tokens).toContain('placeholder:text-ink-faint')

    // `Input` ships `border-input bg-background placeholder:text-muted-foreground`.
    // `cn` runs tailwind-merge, so the token passed here must displace them; if
    // it does not, the field silently keeps the pre-kit colours.
    expect(tokens).not.toContain('border-input')
    expect(tokens).not.toContain('bg-background')
    expect(tokens).not.toContain('placeholder:text-muted-foreground')

    const label = document.querySelector('label') as HTMLLabelElement
    expect(tokensOf(label)).toContain('text-ink')
  })

  it('raises an access failure as a danger alert, and only once one exists', () => {
    const { unmount } = renderPage()
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()

    mockAuthState = { error: 'Invalid email or password.', isLoading: false, isRestoring: false }
    renderPage()

    const alert = screen.getByRole('alert')
    // The message is the context's, verbatim: this screen writes no copy of its
    // own for a failed sign-in.
    expect(alert.textContent).toContain('Invalid email or password.')
    const tokens = tokensOf(alert)
    expect(tokens).toContain('border-danger')
    expect(tokens).toContain('bg-danger-soft')
  })

  it('clears a stale error before sending the typed credential pair', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secreto-123' } })
    await submit()

    expect(mockLogin).toHaveBeenCalledWith({ email: 'ana@example.org', password: 'secreto-123' })
    // The order matters: an error left over from the previous attempt would
    // outlive the request that replaces it.
    expect(mockClearError.mock.invocationCallOrder[0]).toBeLessThan(
      mockLogin.mock.invocationCallOrder[0],
    )
  })

  it('leaves a rejected sign-in to the context: the page stays silent', async () => {
    mockLogin.mockRejectedValueOnce(new Error('401'))
    renderPage()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    await submit()

    // Pinned, not wanted: the empty `catch` means the page adds nothing, and
    // the copy a reader sees is whatever the context set. A silent failure
    // would look exactly like this test passing, so the assertion is on the
    // call, not on the absence of an alert alone.
    expect(mockLogin).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says it is signing in, and blocks a second submit, while the request is in flight', () => {
    // A sign-in this form sent: the restore already finished, so `isRestoring`
    // is false and the pending copy is the true one (#246).
    mockAuthState = { error: null, isLoading: true, isRestoring: false }
    renderPage()

    const pending = screen.getByRole('button', { name: /Signing in/ }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    // The pending copy replaces the idle one; two submit buttons would let a
    // second attempt through the same handler.
    expect(screen.queryByRole('button', { name: 'Sign In' })).toBeNull()
  })

  it('points at the registration screen for someone without an account', () => {
    renderPage()

    expect(screen.getByText(/Don't have an account\?/)).toBeTruthy()
    const link = screen.getByText('Sign up').closest('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/auth/register')
  })

  it('asks auth-api for the provider URL when an OAuth button is pressed', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Google/ }))
    fireEvent.click(screen.getByRole('button', { name: /GitHub/ }))

    expect(mockGetOAuthUrl.mock.calls).toEqual([['google'], ['github']])
    // What the page does with the URL is `window.location.assign(...)`, and
    // this jsdom performs no navigation: neither the redirect nor its absence
    // can be observed from a test. The URL being asked for is the last thing
    // that can be, which is why the provider argument is what is asserted.
  })

  it('carries no palette literal, no deprecated bridge utility and no card or alert', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    // Comments may legitimately name an old utility while explaining why it
    // left; only the live code is asserted against. Line endings are stripped
    // so a CRLF checkout measures the same as an LF one.
    const source = (path: string) =>
      readFileSync(join(process.cwd(), path), 'utf8')
        .replace(/\r/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')

    const page = source('src/app/auth/login/page.tsx')
    const layout = source('src/app/auth/layout.tsx')

    for (const [name, text] of [
      ['login/page.tsx', page],
      ['auth/layout.tsx', layout],
    ] as const) {
      // Tailwind's named palette. Kit tones (`bg-panel-teal`) and kit tokens
      // carry no shade suffix, so they do not match.
      const palette =
        /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/
      expect(text.match(palette), `${name} carries a palette literal`).toBeNull()
      // A hex colour always carries a letter; `#182` in prose does not.
      expect(text, `${name} carries a hex colour`).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
      expect(text, `${name} carries an rgb()/hsl() literal`).not.toMatch(/(?:rgba?|hsla?)\(\s*[\d.]/)

      // The shadcn bridge is not the kit: these are the utilities the issue
      // found in place of the tokens.
      for (const deprecated of [
        'text-muted-foreground',
        'bg-muted',
        'border-input',
        'text-foreground',
        'text-primary',
      ]) {
        expect(text, `${name} still uses ${deprecated}`).not.toMatch(
          new RegExp(`\\b${deprecated}\\b`),
        )
      }
    }

    // `Callout` replaces `Alert`, and `Panel` replaces `Card`.
    expect(page).not.toMatch(/ui\/alert/)
    expect(page).not.toMatch(/ui\/card/)
    expect(page).toMatch(/@\/components\/kit\/Callout/)
    expect(page).toMatch(/@\/components\/kit\/Panel/)
  })
  it('says why an OAuth sign-in failed, instead of showing a blank form', () => {
    // The callback writes `?error=` and, until now, nothing read it: a provider
    // refusal landed here as a form with no explanation at all.
    window.history.replaceState({}, '', '/auth/login?error=access_denied')

    render(<LoginPage />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/did not grant access/i)
  })

  it('carries an unrecognised provider error into the notice instead of swallowing it', () => {
    window.history.replaceState({}, '', '/auth/login?error=server_error')

    render(<LoginPage />)

    expect(screen.getByRole('alert').textContent).toMatch(/server_error/i)
  })

  it('tells a password manager which field is which', () => {
    // Without these, browsers and password managers cannot fill the first
    // screen of the product reliably, and on registration they cannot tell
    // the new password from its confirmation (issue #250).
    const { container } = render(<LoginPage />)
    expect(container.querySelector("#email")?.getAttribute("autocomplete")).toBe("email")
    expect(container.querySelector("#password")?.getAttribute("autocomplete")).toBe("current-password")
  })
})

describe('#246 — the button does not claim a sign-in nobody asked for', () => {
  it('says "Sign In" while the session is being restored', () => {
    // Opening /auth/login with a stored refresh token starts the context with
    // both flags set. The button read `isLoading` as "the form is being
    // submitted" and said "Signing in..." — on the first screen a returning
    // reader sees, about a request nobody sent.
    mockAuthState = { error: null, isLoading: true, isRestoring: true }
    renderPage()

    const button = screen.getByRole('button', { name: /sign in/i })
    // The idle copy, whole.
    expect(button.textContent).toBe('Sign In')
    // `textContent` cannot see the spinner: `Loader2` is an `<svg aria-hidden>` with
    // no text node, so the copy assertion above would pass with one re-added.
    expect(button.querySelector('svg')).toBeNull()
    // Still not pressable: nothing can be submitted until the context knows whether
    // there is a session. It just stops narrating a fiction.
    expect(button.hasAttribute('disabled')).toBe(true)
    // And an inert control names why, in words that are not the submit's: the
    // paragraph is the button's description while it waits.
    const reason = screen.getByRole('status')
    expect(reason.textContent).toMatch(/checking your session/i)
    expect(button.getAttribute('aria-describedby')).toBe(reason.getAttribute('id'))
  })

  it('says nothing about a session once the context has decided, and lets the form be sent', () => {
    renderPage()

    // The region stays mounted — a live region created with its content is not
    // announced — so "silent" is an empty text, not an absent element.
    expect(screen.getByRole('status').textContent).toBe('')
    // And — the assertion this file was missing — a button a reader can actually
    // press. Every submit test drives the form through `fireEvent.submit`, which a
    // dead button would not stop, so a permanently disabled button used to pass
    // the whole suite.
    const button = screen.getByRole('button', { name: 'Sign In' })
    expect(button.getAttribute('aria-describedby')).toBeNull()
    expect(button.hasAttribute('disabled')).toBe(false)
    // The idle branch draws no spinner either; `textContent` alone cannot see one.
    expect(button.querySelector('svg')).toBeNull()
  })
})
