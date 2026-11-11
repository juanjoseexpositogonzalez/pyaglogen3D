/**
 * `AuthContext.register` turns the API's field errors into one sentence (#248).
 *
 * The register page mocks `useAuth`, so its tests cannot see this: they receive
 * whatever string the context produced. This file renders the real provider with a
 * probe consumer, `authApi` mocked and `AuthApiError` left **real** — the context
 * branches on `instanceof`, so a fake class would take the generic path by accident
 * and the test would pass for the wrong reason.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRegister = vi.fn()
const mockPush = vi.fn()
const mockRefreshToken = vi.fn()
const mockGetMe = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('@/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-api')>('@/lib/auth-api')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      register: (...args: unknown[]) => mockRegister(...args),
      refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
      getMe: (...args: unknown[]) => mockGetMe(...args),
    },
  }
})

import { AuthApiError } from '@/lib/auth-api'

import { AuthProvider, useAuth } from '../AuthContext'

function Probe() {
  const { register, error } = useAuth()
  return (
    <div>
      <button
        onClick={() => {
          void register({} as never).catch(() => {
            // `register` rethrows after formatting; the probe only cares about `error`.
          })
        }}
      >
        register
      </button>
      <p data-testid="error">{error ?? 'none'}</p>
    </div>
  )
}

const renderWithProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

const submit = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'register' }))
  await waitFor(() => expect(screen.getByTestId('error').textContent).not.toBe('none'))
  return screen.getByTestId('error').textContent ?? ''
}

// `unknown` on purpose: a witness that can only send `string[]` cannot reach the
// branches that handle DRF's other shapes, which is how the first version of this
// file left them untested.
const rejectWith = (data: Record<string, unknown>) =>
  mockRegister.mockRejectedValue(new AuthApiError('Registration failed', 400, data as never))

describe('the message a refused registration produces', () => {
  beforeEach(() => {
    localStorage.clear()
    mockRegister.mockReset()
    mockPush.mockReset()
  })

  it('names a name field the API rejected', async () => {
    // Measured in #248: `{"first_name": ["Invalid characters"]}` produced the generic
    // `err.message`, because only four keys were read. The field that failed was never
    // named, which is the one thing the reader needs to fix it.
    rejectWith({ first_name: ['Invalid characters'] })
    renderWithProvider()

    const message = await submit()

    expect(message).toContain('Invalid characters')
    expect(message).toMatch(/first name/i)
  })

  it('leaves a transport sentence alone instead of labelling it as a field', async () => {
    // Found in review: `detail` and `code` are what `authFetch` reads as the message,
    // so labelling them turned "Token is invalid or expired" into
    // "Detail: Token is invalid or expired; Code: token_not_valid" — a machine token
    // in front of a person.
    rejectWith({ detail: 'Token is invalid or expired', code: 'token_not_valid' })
    renderWithProvider()

    expect(await submit()).toBe('Token is invalid or expired')
  })

  it('reads the prose out of an array of objects', async () => {
    // SimpleJWT nests the human text under `message` and the rest is a token class.
    // `[object Object]` is not a sentence.
    rejectWith({
      detail: 'Given token not valid for any token type',
      messages: [{ token_class: 'AccessToken', token_type: 'access', message: 'Token is invalid' }],
    })
    renderWithProvider()

    const message = await submit()

    expect(message).toContain('Given token not valid for any token type')
    expect(message).toContain('Token is invalid')
    expect(message).not.toContain('[object Object]')
  })

  it('labels a field whose value is a plain string, not an array', async () => {
    // DRF wraps field errors in arrays, but not every view does.
    rejectWith({ password_confirm: 'Passwords do not match.' })
    renderWithProvider()

    expect(await submit()).toBe('Password confirmation: Passwords do not match.')
  })

  it('keeps `non_field_errors` unprefixed, even beside a field error', async () => {
    rejectWith({ non_field_errors: ['Something went wrong.'], password: ['Too short.'] })
    renderWithProvider()

    // The form speaking has no field name; the field keeps its label.
    expect(await submit()).toBe('Something went wrong.; Password: Too short.')
  })

  it('says nothing at all when the body carries no text', async () => {
    // `null` and an empty array are not messages: the generic sentence is better
    // than `Email: null` or `Email: `.
    rejectWith({ email: null, password: [] })
    renderWithProvider()

    expect(await submit()).toBe('Registration failed')
  })

  it('names a key that collides with the object prototype', async () => {
    // A bare `FIELD_LABELS[key]` lookup reads through the prototype chain and would
    // put `function Object() { [native code] }` in the alert.
    rejectWith({ constructor: ['nope'] })
    renderWithProvider()

    expect(await submit()).toBe('Constructor: nope')
  })

  it('keeps the wording the four known fields already had', async () => {
    rejectWith({
      email: ['A user with this email already exists.'],
      password_confirm: ['Passwords do not match.'],
    })
    renderWithProvider()

    const message = await submit()

    expect(message).toContain('Email: A user with this email already exists.')
    expect(message).toContain('Password confirmation: Passwords do not match.')
  })

  it('names a field nobody taught it about instead of dropping it', async () => {
    // The server is the authority on which fields exist; a list of four keys is a
    // guarantee that the fifth one is silent.
    rejectWith({ username: ['Enter a valid username.'] })
    renderWithProvider()

    const message = await submit()

    // Exact, not `toMatch(/username/i)`: the server's own text contains "username",
    // so any label at all — including a generic `Field:` — satisfied the loose match
    // and the fallback this change adds was unpinned.
    expect(message).toBe('Username: Enter a valid username.')
  })
})

/**
 * The mount-time restore is its own state (#246).
 *
 * The sign-in screen's tests mock `useAuth`, so they can only ever witness the
 * page's *derivation* from a hand-set pair of booleans. Whether the provider
 * ever produces that pair is unwitnessed there — delete the initialiser or one
 * of the exits in `AuthContext` and every page test stays green while every
 * returning reader gets a permanently dead button. These four probes are on the
 * real provider, with `authApi` mocked and the storage the provider reads held
 * by jsdom.
 */
describe('the restore flag the sign-in button depends on', () => {
  function Flags() {
    const { isLoading, isRestoring, user } = useAuth()
    return (
      <p data-testid="flags">
        {`loading=${String(isLoading)} restoring=${String(isRestoring)} user=${user?.email ?? 'none'}`}
      </p>
    )
  }

  const renderFlags = () =>
    render(
      <AuthProvider>
        <Flags />
      </AuthProvider>,
    )

  const flags = () => screen.getByTestId('flags').textContent
  const settled = (expected: string) => waitFor(() => expect(flags()).toBe(expected))

  beforeEach(() => {
    localStorage.clear()
    mockPush.mockReset()
    mockRefreshToken.mockReset()
    mockGetMe.mockReset()
  })

  it('settles with no stored session, and asks the server nothing', async () => {
    renderFlags()

    await settled('loading=false restoring=false user=none')
    // The absence of a token is decided locally: a visitor with no session must
    // not cost a request, and must not wait for one to be told they have none.
    expect(mockRefreshToken).not.toHaveBeenCalled()
  })

  it('is still restoring while the stored session is being fetched', async () => {
    localStorage.setItem('pyaglogen3d_refresh_token', 'stored')
    let releaseRefresh: (value: { access: string }) => void = () => {}
    mockRefreshToken.mockReturnValue(
      new Promise<{ access: string }>((resolve) => {
        releaseRefresh = resolve
      }),
    )
    mockGetMe.mockResolvedValue({ email: 'ana@example.org' } as never)
    renderFlags()

    // The first render of a returning reader: both flags true, no user yet. This
    // is the exact state the sign-in button used to narrate as "Signing in...".
    expect(flags()).toBe('loading=true restoring=true user=none')

    releaseRefresh({ access: 'a-token' })
    await settled('loading=false restoring=false user=ana@example.org')
  })

  it('settles when the server refuses the stored token', async () => {
    localStorage.setItem('pyaglogen3d_refresh_token', 'stored')
    mockRefreshToken.mockRejectedValue(new Error('401'))

    renderFlags()

    await settled('loading=false restoring=false user=none')
    // A refusal is not a reason to keep the sign-in form inert.
    expect(mockGetMe).not.toHaveBeenCalled()
  })

  it('settles when storage itself refuses to be read', async () => {
    // Safari in private mode and "block all cookies" make `localStorage.getItem`
    // throw a SecurityError. Read outside the `try`, it escaped before the
    // `finally`, so both flags stayed true for as long as the tab lived: the app
    // stuck behind its loading gate and this button dead, saying "Sign In".
    // On the instance, not on `Storage.prototype`: jsdom's `localStorage` does not
    // resolve `getItem` through the prototype, so a prototype spy never fires and
    // the probe would pass without the block ever happening (measured).
    const blocked = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: the operation is insecure.')
    })

    try {
      renderFlags()

      await settled('loading=false restoring=false user=none')
    } finally {
      blocked.mockRestore()
    }
  })
})
