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

const rejectWith = (data: Record<string, string[]>) =>
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

    expect(message).toContain('Enter a valid username.')
    expect(message).toMatch(/username/i)
  })
})
