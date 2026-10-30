/**
 * The compare screen on the design-system kit (issue #175, slice 1 of 2).
 *
 * Slice 1 owns the frame: the page header, the three states a comparison can be
 * in (loading, failed request, fewer than two simulations) and the surface the
 * comparison itself sits on. Slice 2 owns the metrics table and the Rg chart, so
 * both are stubbed here: a failure in this file is about the surfaces this file
 * owns and never about a neighbour it only mounts.
 *
 * Asserted through what a reader perceives — headings, roles, links, the words
 * of each state — rather than through which components were imported, because a
 * test that checks imports passes a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'

const state = vi.hoisted(() => ({ sims: 'sim-a,sim-b' }))

const mockUseQueries = vi.fn()
const mockUseProject = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useSearchParams: () => new URLSearchParams(state.sims ? `sims=${state.sims}` : ''),
  usePathname: () => '/projects/p1/compare',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) =>
    React.createElement(
      'a',
      {
        href,
        onClick: (event: React.MouseEvent) => {
          if (!event.defaultPrevented) mockPush(href)
        },
      },
      children,
    ),
}))

// The page reads `useQueries` to know which simulations arrived; driving those
// states directly is what lets each state be rendered without a network.
vi.mock('@tanstack/react-query', () => ({
  useQueries: () => mockUseQueries(),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProject: () => mockUseProject(),
}))

// Neighbours owned by slice 2 and the 3D layer. The names are deliberately not
// the page's own words, so a test can tell "the child is mounted here" from
// "the page printed this text".
vi.mock('@/components/compare/CompareGrid', () => ({
  CompareGrid: () => React.createElement('div', {}, 'compare grid widget'),
}))

vi.mock('@/components/compare/CompareOverlay', () => ({
  CompareOverlay: () => React.createElement('div', {}, 'compare overlay widget'),
}))

vi.mock('@/components/compare/CompareMetricsTable', () => ({
  CompareMetricsTable: () => React.createElement('div', {}, 'compare metrics widget'),
}))

vi.mock('@/components/charts/RgEvolutionChart', () => ({
  RgEvolutionChart: () => React.createElement('div', {}, 'rg evolution widget'),
}))

import CompareSimulationsPage from '../page'

/** A completed simulation with geometry, as the fetch would return it. */
const fetched = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  simulation: {
    id,
    project: 'p1',
    name,
    algorithm: 'tunable_cc',
    status: 'completed',
    parameters: { primary_particle_diameter_nm: 20, n_particles: 1200 },
    metrics: { fractal_dimension: 1.8, prefactor: 1.4, radius_of_gyration: 12 },
    created_at: '2026-10-20T10:00:00Z',
    ...overrides,
  },
  geometry: { coordinates: [[0, 0, 0]], radii: [1] },
})

const loadedQuery = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  isLoading: false,
  isPending: false,
  isError: false,
  error: null,
  data: fetched(id, name, overrides),
})

const loadingQuery = () => ({
  isLoading: true,
  isPending: false,
  isError: false,
  error: null,
  data: undefined,
})

const failedQuery = (error: unknown) => ({
  isLoading: false,
  isPending: false,
  isError: true,
  error,
  data: undefined,
})

const withQueries = (queries: unknown[]) => mockUseQueries.mockReturnValue(queries)

const withSims = (sims: string) => {
  state.sims = sims
}

/** Drive a run of two simulations that both arrived. */
const withTwoLoaded = () =>
  withQueries([loadedQuery('sim-a', 'Agg A'), loadedQuery('sim-b', 'Agg B')])

const renderPage = () => render(<CompareSimulationsPage />)

/** The page header, reached from the title so no panel heading can win. */
const pageHeader = (): HTMLElement =>
  screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement

/** The kit frame a child is mounted in: `Panel` paints `shadow-panel`. */
const kitFrameOf = (child: HTMLElement): HTMLElement | null =>
  child.closest('[class*="shadow-panel"]')

beforeEach(() => {
  vi.clearAllMocks()
  state.sims = 'sim-a,sim-b'
  withTwoLoaded()
  mockUseProject.mockReturnValue({
    data: { id: 'p1', name: 'Soot aggregates' },
    isLoading: false,
    error: null,
  })
})

describe('the compare frame', () => {
  it('opens with the project name as the only level-one heading', () => {
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Soot aggregates')
  })

  it('keeps a name on the page when the project itself could not be read', () => {
    mockUseProject.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    })
    renderPage()

    // The comparison does not depend on the project record, so a failed project
    // fetch must not take the screen down with it — but the page still needs a
    // title, and an empty <h1> leaves it unnamed.
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect((headings[0].textContent ?? '').trim().length).toBeGreaterThan(0)
    expect(screen.getByText('compare grid widget')).toBeTruthy()
  })

  it('stops mounting the deprecated navigation', () => {
    const { container } = renderPage()

    expect(container.querySelector('nav')).toBeNull()
  })

  it('leaves the page frame to the shell instead of nesting its own main', () => {
    const { container } = renderPage()

    // AppShell owns <main>: it carries the 1440px measure and the shell padding.
    // A second one nests two scroll containers and double-pads at every width.
    expect(container.querySelector('main')).toBeNull()
  })

  it('keeps the way back to the project the comparison came from', () => {
    renderPage()

    expect(screen.getByRole('link', { name: /back to project/i }).getAttribute('href')).toBe(
      '/projects/p1',
    )
  })

  it('says how much of the requested set arrived, under the title', () => {
    withQueries([
      loadedQuery('sim-a', 'Agg A'),
      failedQuery(new ApiError('gone', 404)),
    ])
    renderPage()

    expect(pageHeader().textContent).toMatch(/1 of 2 loaded/i)
  })
})

describe('the states a comparison passes through', () => {
  it('says the simulations are still arriving instead of that none exist', () => {
    withQueries([loadingQuery(), loadingQuery()])
    renderPage()

    expect(screen.getByText(/loading simulations/i)).toBeTruthy()
    // A request in flight is not an empty set, and it is not a failure.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: /compare/i })).toBeNull()
  })

  it('reports a request that did not come back as a failure, not as a missing simulation', () => {
    withQueries([failedQuery(new Error('network down')), failedQuery(new Error('network down'))])
    renderPage()

    // Failure is announced, not merely tinted.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/failed to load simulations/i)
    expect(alert.textContent).toMatch(/did not come back/i)
    // "You picked too few" is a different condition and must not stand in for it:
    // only one of the two screens can tell a reader what to do next.
    expect(alert.textContent).not.toMatch(/none of the requested/i)
    expect(screen.queryByText(/select two or more/i)).toBeNull()
    expect(screen.queryByText(/fewer than two/i)).toBeNull()
  })

  it('names the simulations the server says are gone, without calling it a failure', () => {
    withQueries([
      loadedQuery('sim-a', 'Agg A'),
      loadedQuery('sim-c', 'Agg C'),
      failedQuery(new ApiError('not found', 404)),
    ])
    withSims('sim-a,sim-c,sim-deleted-1')
    renderPage()

    // 404/403 is an answer, not an outage: the other two still compare.
    const note = screen.getByTestId('compare-missing-banner')
    expect(note.textContent).toMatch(/1 of 3 simulations could not be loaded/i)
    expect(note.textContent).toMatch(/sim-dele/)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('compare grid widget')).toBeTruthy()
  })

  it('asks for two simulations instead of drawing a comparison of one', () => {
    withSims('sim-a')
    withQueries([loadedQuery('sim-a', 'Agg A')])
    renderPage()

    // One cell is not a comparison, and the grid would have nowhere to put it.
    expect(screen.queryByText('compare grid widget')).toBeNull()
    const heading = screen.getByRole('heading', { level: 2, name: /fewer than two/i })
    expect(heading).toBeTruthy()
    // The way out is the screen where the selection is made.
    const action = screen.getByRole('link', { name: /select simulations/i })
    expect(action.getAttribute('href')).toBe('/projects/p1')
  })

  it('says none of the requested simulations are accessible when every fetch is a 404', () => {
    withQueries([failedQuery(new ApiError('gone', 404)), failedQuery(new ApiError('gone', 404))])
    renderPage()

    expect(
      screen.getByRole('heading', { level: 2, name: /fewer than two/i }),
    ).toBeTruthy()
    expect(screen.getByText(/none of the requested simulations are accessible/i)).toBeTruthy()
  })

  it('invites a selection when the URL carries no simulation at all', () => {
    withSims('')
    withQueries([])
    renderPage()

    expect(screen.getByText(/select two or more simulations/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /select simulations/i }).getAttribute('href')).toBe(
      '/projects/p1',
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('notes that the URL asked for more simulations than it renders', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `sim-${i}`)
    withSims(ids.join(','))
    withQueries(ids.slice(0, 9).map((id, i) => loadedQuery(id, `Agg ${i}`)))
    renderPage()

    expect(screen.getByText(/first 9 simulations/i)).toBeTruthy()
    expect(screen.getByText('compare grid widget')).toBeTruthy()
  })

  it('compares the rest of the set when one simulation never answers', () => {
    withQueries([
      loadedQuery('sim-a', 'Agg A'),
      loadedQuery('sim-b', 'Agg B'),
      failedQuery(new Error('timeout')),
    ])
    withSims('sim-a,sim-b,sim-c')
    renderPage()

    // A failure on one id does not confiscate the other two, and it is not
    // reported as a 404 for the id that failed.
    expect(screen.getByRole('alert').textContent).toMatch(/failed to load simulations/i)
    expect(screen.getByText('compare grid widget')).toBeTruthy()
    expect(screen.queryByTestId('compare-missing-banner')).toBeNull()
  })

  it('treats a 403 as an answer about that simulation, not as an outage', () => {
    withQueries([
      loadedQuery('sim-a', 'Agg A'),
      loadedQuery('sim-b', 'Agg B'),
      failedQuery(new ApiError('forbidden', 403)),
    ])
    withSims('sim-a,sim-b,sim-c')
    renderPage()

    // 403 is the server saying who may read what, which the missing list is
    // for. The screen must not accuse the connection of dropping the request.
    expect(screen.getByTestId('compare-missing-banner')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the simulations that are still running out of the comparison, and says so', () => {
    // A running sim comes back without geometry, which is why the page has to
    // tell it apart from a sim whose fetch failed.
    withQueries([
      loadedQuery('sim-a', 'Agg A'),
      loadedQuery('sim-b', 'Agg B'),
      {
        ...loadedQuery('sim-c', 'Agg C', { status: 'running', metrics: null }),
        data: {
          simulation: fetched('sim-c', 'Agg C', { status: 'running', metrics: null }).simulation,
          geometry: null,
        },
      },
    ])
    withSims('sim-a,sim-b,sim-c')
    renderPage()

    expect(screen.getByTestId('compare-processing-banner').textContent).toMatch(
      /1 simulation still processing/i,
    )
    expect(screen.getByText('compare grid widget')).toBeTruthy()
  })
})

describe('the comparison zone', () => {
  it('frames the grid in a kit panel', () => {
    renderPage()

    const grid = screen.getByText('compare grid widget')
    const frame = kitFrameOf(grid)
    expect(frame?.tagName).toBe('SECTION')
    expect(frame?.textContent).toMatch(/comparison/i)
  })

  it('keeps the mode and the camera-sync controls with the comparison they drive', () => {
    renderPage()

    const frame = kitFrameOf(screen.getByText('compare grid widget')) as HTMLElement
    const settings = screen.getByTestId('compare-settings-panel')
    expect(frame.contains(settings)).toBe(true)
    // Above the grid, not below it: the controls describe the view they change.
    expect(
      settings.compareDocumentPosition(screen.getByText('compare grid widget')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('swaps the grid for the overlay without leaving the panel', () => {
    renderPage()

    fireEvent.click(screen.getByTestId('compare-mode-overlay'))

    expect(screen.getByText('compare overlay widget')).toBeTruthy()
    expect(screen.queryByText('compare grid widget')).toBeNull()
    expect(kitFrameOf(screen.getByText('compare overlay widget'))?.tagName).toBe('SECTION')
  })

  it('still mounts the metrics table and the chart this slice does not own', () => {
    renderPage()

    // Slice 2 migrates these two; until then they stay on the page, outside the
    // comparison panel, and dropping one here would be an invisible regression.
    expect(screen.getByText('compare metrics widget')).toBeTruthy()
    expect(screen.getByText('rg evolution widget')).toBeTruthy()
    expect(kitFrameOf(screen.getByText('compare metrics widget'))).toBeNull()
  })
})
