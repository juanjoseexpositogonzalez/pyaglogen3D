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
import { fireEvent, render, screen } from '@testing-library/react'
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
    // undone the migration.
    //
    // Worth knowing what this does and does not prove: rendered here, outside
    // AppShellProvider, the retired Header draws its navigation. Inside the
    // real shell it returns null, so remounting it would be invisible to a
    // user and still turn this red. It guards the import, not the experience
    // — kept because a page growing its own navigation is still worth
    // catching, not because it measures what someone sees.
    expect(container.querySelector('nav')).toBeNull()
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

  it('shows counts as whole numbers, with no decimal point at all', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2)] },
      isLoading: false,
      error: null,
    })
    const { container } = render(<ProjectsPage />)

    // `Num` defaults to two decimals, so dropping `digits={0}` renders
    // "6.00 simulations". The first version of this test asserted against
    // '6.000' — a value that could never appear — so the guard passed with
    // the mutation in place. Assert the shape, not one spelling of it.
    // Bound to its unit: swapping the two counts used to leave every test
    // green while the card claimed "2 simulations" for a project with six.
    expect(screen.getByText('simulations').previousSibling?.textContent).toContain('6')
    expect(screen.getByText('analyses').previousSibling?.textContent).toContain('2')
    expect(container.textContent).not.toMatch(/\d\.\d/)
  })

  // Measured, not assumed: run this file against the page as it stood on
  // develop and three fail — the deprecated header, the tabular numerals and
  // the kit's empty-state surface. The other seven already held, which is the
  // point: they are regression guards for behaviour the port must not lose,
  // not evidence that the port happened.
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

  it('shows the description when there is one and omits it when there is not', () => {
    mockUseProjects.mockReturnValue({
      data: {
        results: [
          project('a', 'Soot aggregates', 6, 2, 'Tunable Df from 1.6 to 2.4'),
          project('b', 'Scratch', 2, 0, null),
        ],
      },
      isLoading: false,
      error: null,
    })
    render(<ProjectsPage />)

    // The earlier version of this test rendered only the project without a
    // description, so it isolated nothing, and matched /2/ against the whole
    // document — a regex that passes on "12" just as happily.
    expect(screen.getByText('Tunable Df from 1.6 to 2.4')).toBeTruthy()
    expect(screen.getByRole('link', { name: /scratch/i })).toBeTruthy()
  })

  it('keeps saying when each project was last touched', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2)] },
      isLoading: false,
      error: null,
    })
    render(<ProjectsPage />)

    // The line a port loses most easily, because nothing else refers to it.
    expect(screen.getByText(/updated/i)).toBeTruthy()
  })

  it('names each project with a second-level heading under the page title', () => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2)] },
      isLoading: false,
      error: null,
    })
    render(<ProjectsPage />)

    expect(screen.getByRole('heading', { level: 2, name: 'Soot aggregates' })).toBeTruthy()
  })

  it('announces the empty state as a heading, not as loose text', () => {
    render(<ProjectsPage />)

    // The screen this replaced used an <h3>. Someone navigating by headings
    // would otherwise stop finding the empty state at all.
    expect(screen.getByRole('heading', { name: /no projects yet/i })).toBeTruthy()
  })
})

describe('deleting a project', () => {
  const confirmSpy = vi.fn(() => true)

  beforeEach(() => {
    mockUseProjects.mockReturnValue({
      data: { results: [project('a', 'Soot aggregates', 6, 2)] },
      isLoading: false,
      error: null,
    })
    vi.stubGlobal('confirm', confirmSpy)
  })

  // This PR promises it does not change the delete behaviour. Nothing proved
  // it: removing the button entirely left all ten tests green.
  it('offers a delete control that says what it deletes', () => {
    render(<ProjectsPage />)

    expect(screen.getByRole('button', { name: /delete soot aggregates/i })).toBeTruthy()
  })

  it('asks before deleting and then deletes that project', () => {
    render(<ProjectsPage />)

    fireEvent.click(screen.getByRole('button', { name: /delete soot aggregates/i }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(mockMutate).toHaveBeenCalledWith('a')
  })

  it('does not delete when the confirmation is declined', () => {
    confirmSpy.mockReturnValueOnce(false)
    render(<ProjectsPage />)

    fireEvent.click(screen.getByRole('button', { name: /delete soot aggregates/i }))

    expect(mockMutate).not.toHaveBeenCalled()
  })
})
