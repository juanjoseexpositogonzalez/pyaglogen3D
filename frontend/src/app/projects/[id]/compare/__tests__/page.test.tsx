/**
 * The compare screen on the design-system kit (issue #175, slice 1 of 2).
 *
 * Slice 1 owns the frame: the page header, the states a comparison can be in,
 * and the surface the comparison itself sits on. Slice 2 owns the metrics table
 * and the Rg chart, so both are stubbed here: a failure in this file is about
 * the surfaces this file owns and never about a neighbour it only mounts.
 *
 * The states are not three variations of "empty". A request in flight, a run
 * still computing, a refused id (404/403), a dead session (401) and a request
 * that never came back (network) are five different pieces of news, and the
 * empty surface is reserved for the one case where nothing loaded at all —
 * spec `multi-aggregate-comparison` S8.3. S8.4 draws the survivors of a partly
 * refused set, and R5 gives the metrics table one column per loaded simulation,
 * so one load is a comparison of one and is painted, not hidden.
 *
 * Asserted through what a reader perceives — headings, roles, links, the words
 * of each state — rather than through which components were imported, because a
 * test that checks imports passes a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) =>
    React.createElement(
      'a',
      {
        href,
        // Forwarded so a test can see that the look of the link comes from the
        // variant's classes rather than from a <button> nested inside it.
        className,
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
    metrics: {
      fractal_dimension: 1.8,
      prefactor: 1.4,
      radius_of_gyration: 12,
      rg_evolution: [1, 2, 4],
    },
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

/**
 * A simulation whose metadata arrived but whose geometry has not been computed
 * yet — the row that reaches the page as "still processing", not as a failure.
 */
const processingQuery = (id: string, name: string) => ({
  ...loadedQuery(id, name, { status: 'running', metrics: null }),
  data: {
    simulation: fetched(id, name, { status: 'running', metrics: null }).simulation,
    geometry: null,
  },
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
  it('names the screen itself, not the project a second time', () => {
    renderPage()

    // The project detail page already owns "Soot aggregates" as its <h1>. A
    // reader moving by heading would otherwise hear the same title on two
    // different screens, so the eyebrow names the context and the title names
    // what this screen does.
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Compare simulations')
    expect(pageHeader().textContent).toMatch(/PROJECT/)
    // The project name still has to be on the page: it is which project's
    // simulations these are.
    expect(pageHeader().textContent).toMatch(/Soot aggregates/)
  })

  it('keeps a name on the page when the project itself could not be read', () => {
    mockUseProject.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    })
    renderPage()

    // The comparison does not depend on the project record, so a failed project
    // fetch must not take the screen down with it — and the title, which names
    // the screen rather than the project, survives it.
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Compare simulations')
    expect(screen.getByText('compare grid widget')).toBeTruthy()
  })

  it('offers each way out as one link, with no button inside the anchor', () => {
    withSims('')
    withQueries([])
    renderPage()

    // `<Link><Button /></Link>` renders a <button> inside an <a>: invalid HTML,
    // two tab stops for one destination, and the visible target of a
    // modifier-click swallows the new-tab gesture. Both exits are checked here,
    // because both were written the same way.
    for (const name of [/back to project/i, /select simulations/i]) {
      const link = screen.getByRole('link', { name })
      expect(link.tagName).toBe('A')
      expect(link.querySelector('button, a')).toBeNull()
      // It still has to look like a button: the look now comes from the
      // variant's own classes rather than from a nested element.
      expect(link.className).toMatch(/inline-flex/)
    }
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
    // A request in flight is not an empty set, and it is not a failure. (The
    // page <h1> is its own, so what must be absent is the comparison surface
    // and the empty surface — both would be level-two headings.)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('shows the spinner on a kit surface, not on the bare page canvas', () => {
    withQueries([loadingQuery(), loadingQuery()])
    renderPage()

    // `LoadingScreen` paints a bare div; the page owes it a surface for the
    // message it prints. A kit panel is the surface the rest of the product
    // waits on, and its ink is the ink that message was measured against.
    const frame = kitFrameOf(screen.getByText(/loading simulations/i))
    expect(frame?.tagName).toBe('SECTION')
    expect(frame?.className).toMatch(/bg-surface-strong/)
  })

  it('does not claim the comparison is empty while the simulations are still computing', () => {
    withQueries([processingQuery('sim-a', 'Agg A'), processingQuery('sim-b', 'Agg B')])
    renderPage()

    // Two runs in flight is the ordinary way to reach this screen: the project
    // page offers the button with two ticked and never looks at their status.
    // Saying "none are accessible" here would be two banners contradicting each
    // other about whether the runs still exist.
    expect(screen.getByTestId('compare-processing-banner').textContent).toMatch(
      /2 simulations still processing/i,
    )
    expect(screen.queryByText(/none of the requested simulations/i)).toBeNull()
    expect(screen.queryByText(/select two or more/i)).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
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
  })

  it('names the session, not the connection, when the server answers 401', () => {
    withQueries([
      failedQuery(new ApiError('unauthorized', 401)),
      failedQuery(new ApiError('unauthorized', 401)),
    ])
    renderPage()

    // The server answered: the request came back, the session did not. Telling a
    // reader "the request did not come back" would send them to retry a
    // connection that is fine.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/session/i)
    expect(alert.textContent).not.toMatch(/did not come back/i)
    expect(alert.textContent).not.toMatch(/none of the requested/i)
    expect(screen.getByRole('link', { name: /sign in again/i }).getAttribute('href')).toBe(
      '/auth/login',
    )
  })

  it('names the server, not the connection, when the server answers 500', () => {
    withQueries([
      failedQuery(new ApiError('internal error', 500)),
      failedQuery(new ApiError('internal error', 500)),
    ])
    renderPage()

    // A 500 is an answer too: the request arrived and the server broke. "The
    // request did not come back" describes a network that is not the problem,
    // and "your session expired" sends the reader to sign in for nothing.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/server/i)
    expect(alert.textContent).not.toMatch(/did not come back/i)
    expect(alert.textContent).not.toMatch(/session/i)
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

  it('compares the one simulation that arrived instead of hiding it behind an empty state', () => {
    // Spec S8.4: `?sims=A,B` where A returns 403 renders B only. This test used
    // to demand the opposite — an empty state instead of a one-cell grid — and
    // that assertion was wrong: R5 asks for one column per successfully loaded
    // simulation, and hiding the only survivor hides the data the page exists
    // for.
    withSims('sim-a,sim-b')
    withQueries([
      failedQuery(new ApiError('forbidden', 403)),
      loadedQuery('sim-b', 'Agg B'),
    ])
    renderPage()

    expect(screen.getByText('compare grid widget')).toBeTruthy()
    expect(screen.getByTestId('compare-missing-banner').textContent).toMatch(/sim-a/)
    // Nothing is empty here: one cell is what loaded, and it is painted.
    expect(
      screen.queryByRole('heading', { level: 2, name: /no simulations to compare/i }),
    ).toBeNull()
    expect(screen.queryByText(/none of the requested/i)).toBeNull()
  })

  it('keeps the comparison on screen while the rest of the set is still coming', () => {
    withSims('sim-a,sim-b')
    withQueries([loadedQuery('sim-a', 'Agg A'), loadingQuery()])
    renderPage()

    // One arrived and one is in flight: neither the spinner nor the empty state
    // may take the screen, or the reader waits for a comparison that is already
    // drawable. (The comparison panel's own level-two title is expected here;
    // what must be absent is the empty surface.)
    expect(screen.getByText('compare grid widget')).toBeTruthy()
    expect(screen.queryByText(/loading simulations/i)).toBeNull()
    expect(
      screen.queryByRole('heading', { level: 2, name: /no simulations to compare/i }),
    ).toBeNull()
  })

  it('says none of the requested simulations are accessible when every fetch is a 404', () => {
    withQueries([failedQuery(new ApiError('gone', 404)), failedQuery(new ApiError('gone', 404))])
    renderPage()

    // Spec S8.3: no grid, no metrics, no chart — the empty surface plus the
    // warning that names what the server refused.
    expect(screen.getByRole('heading', { level: 2, name: /no simulations to compare/i })).toBeTruthy()
    expect(screen.getByText(/none of the requested simulations are accessible/i)).toBeTruthy()
    expect(screen.queryByText('compare grid widget')).toBeNull()
    expect(screen.getByTestId('compare-missing-banner')).toBeTruthy()
  })

  it('invites a selection when the URL carries no simulation at all', () => {
    withSims('')
    withQueries([])
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: /no simulations to compare/i })).toBeTruthy()
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

  it('keeps the simulation that arrived when another never answered', () => {
    withSims('sim-a,sim-b')
    withQueries([loadedQuery('sim-a', 'Agg A'), failedQuery(new Error('timeout'))])
    renderPage()

    // An outage on one id is news about that id. Today the survivor used to
    // vanish behind a red banner with nothing to act on; it is drawable, so it
    // is drawn, with the failure named above it.
    expect(screen.getByRole('alert').textContent).toMatch(/failed to load simulations/i)
    expect(screen.getByText('compare grid widget')).toBeTruthy()
    expect(screen.getByText('compare metrics widget')).toBeTruthy()
    expect(
      screen.queryByRole('heading', { level: 2, name: /no simulations to compare/i }),
    ).toBeNull()
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
      processingQuery('sim-c', 'Agg C'),
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

  it('frames the metrics table and the chart in kit panels of their own', () => {
    renderPage()

    // Slice 1 left these two on the bare canvas; slice 2 gives each the surface
    // the rest of the product reads on. Both must name what they hold, because
    // the chart's own Plotly title is gone — a heading is the only name a
    // reader gets before the plot.
    //
    // The heading is asserted as the panel's own, by role and exact name: a
    // loose match over the whole subtree was satisfied by the child's own text
    // ("compare metrics widget"), so it would have passed with no heading at all.
    const tableFrame = screen
      .getByRole('heading', { level: 2, name: 'Metrics' })
      .closest('section') as HTMLElement
    expect(tableFrame.tagName).toBe('SECTION')
    expect(tableFrame.contains(screen.getByText('compare metrics widget'))).toBe(true)

    const chartFrame = screen
      .getByRole('heading', { level: 2, name: 'Radius of gyration evolution' })
      .closest('section') as HTMLElement
    expect(chartFrame.tagName).toBe('SECTION')
    expect(chartFrame.contains(screen.getByText('rg evolution widget'))).toBe(true)

    // One frame each: naming the pair under one heading would leave the chart
    // outside the surface it is drawn on.
    expect(tableFrame).not.toBe(chartFrame)
  })

  it('offers the numbers behind the chart, in the chart panel', () => {
    renderPage()

    const chartFrame = screen
      .getByRole('heading', { level: 2, name: 'Radius of gyration evolution' })
      .closest('section') as HTMLElement

    // R7: a chart owes its reader the data behind it, in place. The control sits
    // with the panel's title, which is the pattern the simulation page set.
    const toggle = within(chartFrame).getByRole('button', { name: /show values/i })
    expect(chartFrame.querySelector('header')?.contains(toggle)).toBe(true)

    fireEvent.click(toggle)

    // The table takes the plot's place inside the same frame: nothing moves on
    // screen except the thing being inspected.
    expect(within(chartFrame).queryByText('rg evolution widget')).toBeNull()
    expect(within(chartFrame).getByRole('button', { name: /show chart/i })).toBeTruthy()

    const table = within(chartFrame).getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual(['N', 'Agg A', 'Agg B'])

    // diameter 20 nm → scale 10 → the three samples are 10.00, 20.00, 40.00 nm.
    const firstRow = within(within(table).getAllByRole('row')[1]).getAllByRole('cell')
    expect(firstRow.map((c) => c.textContent)).toEqual(['1', '10.00nm', '10.00nm'])

    fireEvent.click(within(chartFrame).getByRole('button', { name: /show chart/i }))
    expect(within(chartFrame).getByText('rg evolution widget')).toBeTruthy()
  })

  it('counts what is being compared and what is not, above the comparison', () => {
    withSims('sim-a,sim-b,sim-c')
    withQueries([
      loadedQuery('sim-a', 'Agg A'),
      loadedQuery('sim-b', 'Agg B'),
      failedQuery(new ApiError('gone', 404)),
    ])
    renderPage()

    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)

    // Asserted as the rendered number, not as "the text contains a 2": `digits`
    // decides the precision, and a substring match cannot tell 2 from 2.000.
    const compared = cards.find((c) => c.textContent?.includes('Simulations compared'))
    expect(compared?.querySelector('.num')?.textContent).toBe('2')

    const missingFromComparison = cards.find((c) => c.textContent?.includes('Not in the comparison'))
    expect(missingFromComparison?.querySelector('.num')?.textContent).toBe('1')
  })

  it('keeps the counts off the screen when there is no comparison to count', () => {
    withSims('')
    withQueries([])
    renderPage()

    // Two cards reading zero above an empty state is noise describing nothing.
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })
})
