/**
 * The batch page actually labels the projection rows (#191).
 *
 * `simulationLabel` is tested on its own, and that does not prove the page uses
 * it: a judge measured that reintroducing the old `Object.entries` composition
 * at the only call site left the whole suite green. A screen that imports
 * nothing is exactly as green as one that does.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const KF = { mode: 'fixed', value: 1.5 }

const study = {
  id: 's1',
  project: 'p1',
  name: 'Soot sweep',
  description: '',
  base_algorithm: 'tunable_cc',
  base_parameters: { n_particles: 60 },
  parameter_grid: { kf_distribution: [KF] },
  seeds_per_combination: 1,
  sintering_config: null,
  status: 'completed',
  total_simulations: 1,
  completed_simulations: 1,
  created_at: '2026-10-20T10:00:00Z',
  completed_at: '2026-10-20T11:00:00Z',
}

const studyResults = {
  study_id: 's1',
  name: 'Soot sweep',
  description: '',
  base_algorithm: 'tunable_cc',
  base_parameters: { n_particles: 60 },
  parameter_grid: { kf_distribution: [KF] },
  status: 'completed',
  progress: { total: 1, completed: 1, failed: 0, running: 0 },
  results: [
    {
      simulation_id: 'sim-1',
      status: 'completed',
      // The child carries the magnitude under both names, which R13.10 requires.
      parameters: { kf_distribution: KF, target_kf_distribution: KF, n_particles: 60 },
      seed: 42,
      execution_time_ms: 100,
      fractal_dimension: 1.82,
    },
  ],
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
      if (queryKey[0] === 'study-results') return { data: studyResults, isLoading: false }
      return { data: undefined, isLoading: false }
    },
  }
})

import BatchPage from '../page'

describe('batch page — projection row labels (#191)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the varying value once and never a placeholder', () => {
    render(<BatchPage params={{ id: 'p1' }} />)

    // The panel only mounts once a study is selected, which is also the only
    // path a user takes to the export.
    fireEvent.click(screen.getAllByText('Soot sweep')[0])

    const row = screen.getByText(/^Sim /)
    const label = row.textContent ?? ''

    expect(label).toContain('kf_distribution={"mode":"fixed","value":1.5}')
    expect(label).not.toContain('[object Object]')
    // The engine name is the same magnitude and must not be a second column.
    expect(label).not.toContain('target_kf_distribution')
  })
})
