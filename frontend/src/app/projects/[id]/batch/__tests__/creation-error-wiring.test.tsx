/**
 * The batch page shows why a study was refused (#115, point 6).
 *
 * The page's own comment said it: "this page has no error handling, so a
 * rejected request would be an invisible dead button". The backend now names
 * the field that caused a 400 (points 2, 4 and 5); without a render the reader
 * still sees nothing, which is the half that reaches a person.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({ onError: [] as Array<(e: unknown) => void> }))

const study = {
  id: 's1',
  project: 'p1',
  name: 'Soot sweep',
  description: '',
  base_algorithm: 'tunable_cc',
  base_parameters: {},
  parameter_grid: {},
  sintering_config: null,
  status: 'completed',
  total_simulations: 1,
  completed_simulations: 1,
  created_at: '2026-11-03T10:00:00Z',
  completed_at: '2026-11-03T11:00:00Z',
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: 'p1' }),
  usePathname: () => '/projects/p1/batch',
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { id: 'u1' } }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  )
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: (options?: { onError?: (e: unknown) => void }) => {
      // The page creates several mutations; the creation one is the first that
      // declares an onError, and capturing it is the only way to drive the
      // failure path without a live server.
      if (options?.onError) handlers.onError.push(options.onError)
      return { mutate: vi.fn(), isPending: false }
    },
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'studies') return { data: { results: [study] }, isLoading: false }
      if (queryKey[0] === 'project')
        return { data: { id: 'p1', name: 'Project' }, isLoading: false }
      return { data: undefined, isLoading: false }
    },
  }
})

import { ApiError } from '@/lib/api'
import BatchPage from '../page'

describe('a refused creation is visible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.onError.length = 0
  })

  it('renders the field the server named', async () => {
    render(<BatchPage params={{ id: 'p1' }} />)

    expect(handlers.onError.length).toBeGreaterThan(0)
    const error = new ApiError('Request failed: 400', 400, {
      parameter_grid: ["'target_df' must be a real number, got 'abc'."],
    })

    // The state update has to be flushed the way React asks for it: without
    // it the assertion runs against the pre-error render and the test is a
    // liar that passes for the wrong reason.
    const { act } = await import('react')
    act(() => {
      handlers.onError[0](error)
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('parameter_grid')
    expect(alert.textContent).toContain('target_df')
  })

  it('announces a repeated identical refusal', async () => {
    render(<BatchPage params={{ id: 'p1' }} />)
    const { act } = await import('react')
    const error = new ApiError('Request failed: 400', 400, {
      parameter_grid: ['bad'],
    })

    act(() => {
      handlers.onError[0](error)
    })
    const first = screen.getByRole('alert')

    act(() => {
      handlers.onError[0](error)
    })
    const second = screen.getByRole('alert')

    // Same text, different node: an `aria-live` region only speaks when its
    // insertion or its content changes, and someone clicking again because
    // "nothing happened" is the person this banner exists for.
    expect(second).not.toBe(first)
    expect(second.textContent).toContain('bad')
  })

  it('clears the banner when the form is cancelled', async () => {
    render(<BatchPage params={{ id: 'p1' }} />)
    const { act } = await import('react')
    act(() => {
      handlers.onError[0](new ApiError('x', 400, { parameter_grid: ['bad'] }))
    })
    expect(screen.queryByRole('alert')).not.toBeNull()

    act(() => {
      screen.getByRole('button', { name: /new batch study/i }).click()
    })
    act(() => {
      screen.getByRole('button', { name: /cancel/i }).click()
    })

    // A blank form for a new study must not carry the previous refusal: it
    // describes a payload that is no longer on screen.
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
