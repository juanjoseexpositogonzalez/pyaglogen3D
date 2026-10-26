/**
 * The batch page actually shows the sintering warning (#131).
 *
 * The detection module and the warning component are tested on their own.
 * Neither proves the page mounts them, and a screen that imports nothing is
 * exactly as green as one that does.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const study = {
  id: 's1',
  project: 'p1',
  name: 'Soot sweep',
  description: '',
  base_algorithm: 'tunable_cc',
  base_parameters: {},
  parameter_grid: {},
  seeds_per_combination: 1,
  sintering_config: { distribution_type: 'normal', mean: 0.8, std: 0.05 },
  status: 'completed',
  total_simulations: 12,
  completed_simulations: 12,
  created_at: '2026-10-20T10:00:00Z',
  completed_at: '2026-10-20T11:00:00Z',
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
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'studies') return { data: { results: [study] }, isLoading: false }
      if (queryKey[0] === 'project') return { data: { id: 'p1', name: 'Project' }, isLoading: false }
      return { data: undefined, isLoading: false }
    },
  }
})

import BatchPage from '../page'

describe('batch page wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks an affected study in the list of previous studies', () => {
    render(<BatchPage params={{ id: 'p1' }} />)

    // The cheap criterion runs here: the reader has to be able to tell,
    // without opening each one, which studies cannot be compared with the
    // rest.
    expect(screen.getByText(/may have run without sintering/i)).toBeTruthy()
  })

  it('leaves a study created after the fix unmarked', () => {
    study.created_at = '2026-11-02T10:00:00Z'
    render(<BatchPage params={{ id: 'p1' }} />)
    study.created_at = '2026-10-20T10:00:00Z'

    expect(screen.queryByText(/may have run without sintering/i)).toBeNull()
  })
})
