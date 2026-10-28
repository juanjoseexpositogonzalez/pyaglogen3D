/**
 * Projects list migrated onto the design-system kit (wave 2, issue #172).
 *
 * Asserted through what a user can perceive — headings, roles and accessible
 * names — rather than through which components were imported. A test that
 * checks imports passes a refactor that breaks the page.
 *
 * `DataTable` and `StatusChip` are deliberately absent: `Project` carries no
 * status field, and this screen is a card grid, not a table. They belong to
 * the project detail, where `recent_simulations` actually has a status.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProjects = vi.fn()
const mockMutate = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/projects',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => mockUseProjects(),
  useDeleteProject: () => ({ mutate: mockMutate, isPending: false }),
}))

// Only the deprecated header needs this. When the page stops mounting it the
// stub becomes dead weight — which is the signal that the migration landed.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'demo@pyaglogen3d.dev' }, logout: vi.fn() }),
}))

import ProjectsPage from '../page'

const project = (id: string, name: string, sims: number, analyses: number, description: string | null = null) => ({
  id,
  name,
  description,
  simulation_count: sims,
  analysis_count: analyses,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
})

beforeEach(() => {
  vi.clearAllMocks()
  mockUseProjects.mockReturnValue({ data: { results: [] }, isLoading: false, error: null })
})

describe('the projects list', () => {
  it('opens with the page title as the only level-one heading', () => {
    render(<ProjectsPage />)

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Projects')
  })

  it('stops mounting the deprecated header', () => {
    const { container } = render(<ProjectsPage />)

    // Not "renders no <header>": the kit's own PageHeader is a <header>, so
    // that assertion failed for the wrong reason and satisfying it would have
    // undone the migration. What the retired header brought was navigation,
    // and the shell in app/layout.tsx owns that now.
    expect(container.querySelector('nav')).toBeNull()
    expect(screen.queryByRole('button', { name: /sign out|log out/i })).toBeNull()
  })

  it('says it is loading while the request is in flight', () => {
    mockUseProjects.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<ProjectsPage />)

    expect(screen.getByText(/loading projects/i)).toBeTruthy()
  })

  it('reports a failure instead of pretending the list is empty', () => {
    mockUseProjects.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') })
    render(<ProjectsPage />)

    // An error rendered as "no projects yet" would tell the user their work
    // is gone. The two states must not look alike.
    expect(screen.getByText(/failed to load projects/i)).toBeTruthy()
    expect(screen.queryByText(/no projects yet/i)).toBeNull()
  })

  it('offers a way out when there is nothing yet', () => {
    render(<ProjectsPage />)

    expect(screen.getByText(/no projects yet/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /create project/i })).toBeTruthy()
  })

  it('lists one entry per project, each linking to it', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2), project('b', 'Scratch', 2, 0)] },
      isLoading: false,
      error: null,
    })
    render(<ProjectsPage />)

    expect(screen.getByRole('link', { name: /soot aggregates/i }).getAttribute('href')).toBe('/projects/a')
    expect(screen.getByRole('link', { name: /scratch/i }).getAttribute('href')).toBe('/projects/b')
  })

  it('shows counts as whole numbers, not as 6.000', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2)] },
      isLoading: false,
      error: null,
    })
    const { container } = render(<ProjectsPage />)

    // `Num` defaults to three decimals. A count of simulations with decimals
    // is the defect the Dashboard migration shipped and a judge caught.
    expect(container.textContent).toContain('6')
    expect(container.textContent).not.toContain('6.000')
    expect(container.textContent).not.toContain('2.000')
  })

  // The seven assertions above describe behaviour a user can perceive, and
  // most of them already held before the migration: that is the point, they
  // are regression guards. The two below are what actually changes, so they
  // are the ones that start red.
  it('renders counts with the tabular numerals of the kit', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2)] },
      isLoading: false,
      error: null,
    })
    const { container } = render(<ProjectsPage />)

    // `.num` carries the monospace, tabular-nums styling, so counts line up
    // down a column instead of drifting with the glyph widths.
    expect(container.querySelectorAll('.num').length).toBeGreaterThanOrEqual(2)
  })

  it('draws the empty state on the kit surface, not on a raw card', () => {
    const { container } = render(<ProjectsPage />)

    expect(container.querySelector('.border-dashed')).not.toBeNull()
  })

  it('keeps the card readable when a project has no description', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Scratch', 2, 0, null)] },
      isLoading: false,
      error: null,
    })
    render(<ProjectsPage />)

    expect(screen.getByRole('link', { name: /scratch/i })).toBeTruthy()
    expect(screen.getByText(/2/)).toBeTruthy()
  })
})
