/**
 * Simulation detail migrated onto the design-system kit (issue #180).
 *
 * Slice 1 is the header, the identity row and the headline readings; slice 2 is
 * the 3D stage and the values behind it. The projections, the topology graph,
 * the optical section, the parameters table and the FRAKTAL dialog belong to
 * slice 3 and are stubbed here, so a failure in this file is about the pieces
 * this file owns and never about a neighbour.
 *
 * Asserted through what a user can perceive — headings, roles, accessible
 * names, hrefs and the rendered numbers — rather than through which components
 * were imported. A test that checks imports passes a refactor that breaks the
 * page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockUseSimulation = vi.fn()
const mockUseSimulationGeometry = vi.fn()
const mockRefetch = vi.fn()
const mockPush = vi.fn()
const mockExportCsv = vi.fn()
const mockCancel = vi.fn()
const mockDelete = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/projects/p1/simulations/s1',
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

vi.mock('@/hooks/useProjects', () => ({
  useProject: () => mockUseProject(),
}))

vi.mock('@/hooks/useSimulations', () => ({
  useSimulation: () => mockUseSimulation(),
  useSimulationGeometry: () => mockUseSimulationGeometry(),
  useNeighborGraph: () => ({ data: null, isLoading: false }),
}))

// Lazy wrappers rather than direct references: the factory runs before this
// module's body, so a `vi.fn()` captured eagerly would be reached in its
// temporal dead zone.
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  simulationsApi: {
    exportCsv: (...args: unknown[]) => mockExportCsv(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    getProjection: vi.fn(),
    getProjectionBatch: vi.fn(),
    exportProjections: vi.fn(),
  },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'demo@pyaglogen3d.dev' }, logout: vi.fn() }),
}))

vi.mock('@/components/banners/UnitConventionBanner', () => ({
  UnitConventionBanner: () => React.createElement('div', {}, 'Unit convention changed'),
}))

// Neighbours owned by later slices, and by the shell. Stubbed so a plotly chart
// or a projection cannot decide whether this slice is correct. The 3D viewer
// itself is stubbed too: this file asserts where it is mounted and when it is
// replaced, not what three.js paints.
vi.mock('@/components/viewer3d/AgglomerateViewer', () => ({
  AgglomerateViewer: () => React.createElement('div', {}, 'viewer'),
}))

vi.mock('@/components/viewer3d/ViewerControls', () => ({
  ViewerControls: () => React.createElement('div', {}, 'viewer controls'),
}))

vi.mock('@/components/projection', () => ({
  ProjectionViewer: () => React.createElement('div', {}, 'projection viewer'),
  ProjectionControls: () => React.createElement('div', {}, 'projection controls'),
}))

vi.mock('@/components/topology', () => ({
  NeighborGraph: () => React.createElement('div', {}, 'neighbor graph'),
}))

vi.mock('@/components/charts', () => ({
  FractalPlot: () => React.createElement('div', {}, 'fractal plot'),
}))

vi.mock('@/components/analysis', () => ({
  BoxCountingAnalysis: () => React.createElement('div', {}, 'box counting'),
  LimitingCasesCard: () => React.createElement('div', {}, 'limiting cases'),
  OpticalPropertiesSection: () => React.createElement('div', {}, 'optical'),
  LIMITING_CASES: [],
}))

import SimulationDetailPage from '../page'

const simulation = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  project: 'p1',
  name: 'Baseline run',
  algorithm: 'tunable_cc',
  status: 'completed',
  // 50 nm diameter makes the Rg scale an exact 25, so the expected reading is
  // arithmetic — 12 × 25 = 300 nm — rather than whatever the fixture's
  // parameters happen to produce.
  parameters: { primary_particle_diameter_nm: 50, n_particles: 1200 },
  seed: 42,
  metrics: {
    fractal_dimension: 1.8234,
    fractal_dimension_std: 0.0212,
    prefactor: 1.7,
    radius_of_gyration: 12,
    porosity: 0.4123,
    coordination: { mean: 2.345, std: 0.51 },
    anisotropy: 1.2,
    asphericity: 0.051,
    acylindricity: 0.024,
    principal_moments: [10.4, 20.9, 30.1] as [number, number, number],
    principal_axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as [[number, number, number], [number, number, number], [number, number, number]],
  },
  execution_time_ms: 1200,
  created_at: '2026-10-20T10:00:00Z',
  completed_at: '2026-10-20T10:01:00Z',
  ...overrides,
})

const renderPage = () => render(<SimulationDetailPage params={{ id: 'p1', simId: 's1' }} />)

/**
 * Two particles in dimensionless engine units. The record's 50 nm diameter
 * makes the page scale them by 25, so every expected cell value below is
 * arithmetic: 0.1 → 2.5 nm, -0.2 → -5.0 nm, radius 0.06 → 1.5 nm.
 */
const geometry = (overrides: Record<string, unknown> = {}) => ({
  coordinates: [
    [0.1, -0.2, 0.4],
    [1, 2, 3],
  ],
  radii: [0.04, 0.06],
  ...overrides,
})

const withGeometry = (data: unknown = geometry()) =>
  mockUseSimulationGeometry.mockReturnValue({ data })

const withSimulation = (overrides: Record<string, unknown> = {}) =>
  mockUseSimulation.mockReturnValue({
    data: simulation(overrides),
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })

/**
 * The metric card that carries `label`, wherever else the same word appears.
 *
 * "Fractal dimension" is also a phrase in the analysis section further down, so
 * a bare getByText finds two nodes and the test would fail for a reason that
 * has nothing to do with what it checks.
 */
const metricCard = (label: string): HTMLElement | null | undefined =>
  screen
    .getAllByText(label)
    .map((node) => node.closest('article'))
    .find((node) => node !== null) ?? undefined

/** The readings inside one metric card, in document order. */
const cardNumbers = (label: string): string[] =>
  Array.from(metricCard(label)?.querySelectorAll('.num') ?? []).map(
    (node) => node.textContent ?? '',
  )

/** The page header, reached from the title so a metric card's own header cannot win. */
const pageHeader = (): HTMLElement =>
  screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement

/** The 3D stage, reached from its own title so no other section can win. */
const viewerPanel = (): HTMLElement =>
  screen.getByRole('heading', { name: '3D Visualization' }).closest('section') as HTMLElement

/** The numbers rendered inside the 3D stage, in document order. */
const panelNumbers = (): string[] =>
  Array.from(viewerPanel().querySelectorAll('.num')).map((node) => node.textContent ?? '')

beforeEach(() => {
  vi.clearAllMocks()
  mockExportCsv.mockResolvedValue(new Blob(['a,b']))
  mockCancel.mockResolvedValue(undefined)
  mockDelete.mockResolvedValue(undefined)
  // No geometry by default: the engine has not answered yet, or this record
  // has no particle positions. That is the empty stage, not a blank canvas.
  mockUseSimulationGeometry.mockReturnValue({ data: undefined })
  mockUseProject.mockReturnValue({
    data: { id: 'p1', name: 'Soot aggregates' },
    isLoading: false,
    error: null,
  })
  withSimulation()
})

describe('the simulation detail frame', () => {
  it('opens with the simulation name as the only level-one heading', () => {
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Baseline run')
  })

  it('falls back to the algorithm for a legacy record that has no name', () => {
    // `name` is optional on the wire: records written before the field existed
    // come back without one, and an empty <h1> would leave the page unnamed.
    withSimulation({ name: undefined })
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    // The label the create form shows, not the wire token: `tunable_cc` is a
    // value on the request, not a name a researcher reads.
    const title = headings[0].textContent ?? ''
    expect(title).toMatch(/tunable cc/i)
    expect(title).not.toMatch(/tunable_cc/)
  })

  it('stops mounting the deprecated navigation', () => {
    const { container } = renderPage()

    // Not "renders no <header>": the kit's own PageHeader is a <header>, so
    // that assertion would fail for the wrong reason. Rendered outside
    // AppShellProvider the retired Header still draws its navigation, while
    // inside the real shell it renders nothing — so this guards the import,
    // not the experience. Kept because a page growing its own navigation is
    // worth catching either way.
    expect(container.querySelector('nav')).toBeNull()
  })

  it('leaves the page frame to the shell instead of nesting its own main', () => {
    const { container } = renderPage()

    // AppShell owns <main>: it carries the 1440px measure and the shell
    // padding. A page rendering a second one nests two scroll containers and
    // double-pads at every width.
    expect(container.querySelector('main')).toBeNull()
  })

  it('keeps the way back to the project the run belongs to', () => {
    renderPage()

    expect(screen.getByRole('link', { name: /back to/i }).getAttribute('href')).toBe('/projects/p1')
  })

  it('says what state the run is in, in words, under the title', () => {
    renderPage()

    // Status is never colour alone: the chip carries the word.
    expect(pageHeader().textContent).toMatch(/completed/i)
  })

  it('reports a failed load without a nested page frame', () => {
    mockUseSimulation.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch: mockRefetch,
    })
    const { container } = renderPage()

    expect(container.textContent).toMatch(/failed to load simulation/i)
    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('nav')).toBeNull()
  })
})

describe('the run identity in the header', () => {
  it('puts the seed, the particle count and the run time in the meta row', () => {
    renderPage()

    const meta = pageHeader()
    const numbers = Array.from(meta.querySelectorAll('.num')).map((node) => node.textContent)

    // Every number goes through `Num`, so it is monospaced and grouped, and
    // the count reads 1,200 rather than 1200.
    expect(numbers).toContain('42')
    expect(numbers).toContain('1,200')
    // 1200 ms is 1.20 s, at the two decimals the page has always shown.
    expect(numbers).toContain('1.20')
    expect(meta.textContent).toMatch(/seed/i)
    expect(meta.textContent).toMatch(/particles/i)
    expect(meta.textContent).toMatch(/1\.20\s*s/)
  })

  it('omits the run time instead of printing a placeholder for it', () => {
    // A queued run has no measured duration. Forbidding only the em dash would
    // pass an implementation printing "0.00 s", which is the "took no time"
    // reading the copy exists to prevent.
    withSimulation({ status: 'queued', metrics: null, execution_time_ms: null })
    renderPage()

    const meta = pageHeader().textContent ?? ''
    expect(meta).not.toMatch(/—/)
    expect(meta).not.toMatch(/elapsed/i)
    expect(meta).not.toMatch(/\d\.\d\d\s*s/)
  })

  it('names the duration it shows, instead of leaving a bare number in the row', () => {
    withSimulation({ execution_time_ms: 4210 })
    renderPage()

    // The icon that used to identify the number is gone with the old header; a
    // floating "4.21 s" between two labelled items reads as nobody's number.
    expect(pageHeader().textContent).toMatch(/elapsed\s*4\.21\s*s/i)
  })

  it('says when the run happened, which the identity row is for', () => {
    withSimulation({ created_at: '2026-10-20T10:00:00Z' })
    renderPage()

    expect(pageHeader().textContent).toMatch(/ago/i)
  })
})

describe('the readings of a completed run', () => {
  it('shows the engine note when a reading was not computed', () => {
    withSimulation({
      status: 'completed',
      metrics: {
        ...simulation().metrics,
        fractal_dimension: null,
        notes: { fractal_dimension: 'Insufficient particles for stable box-counting (N < 50)' },
      },
    })
    renderPage()

    // A dash under "fit slope of Rg versus particle count" would announce a
    // method for a quantity the engine never computed.
    expect(screen.getByText(/insufficient particles/i)).toBeTruthy()
  })

  it('renders the four readings as metric cards', () => {
    renderPage()

    expect(metricCard('Fractal dimension')).toBeTruthy()
    expect(metricCard('Radius of gyration')).toBeTruthy()
    expect(metricCard('Porosity')).toBeTruthy()
    expect(metricCard('Prefactor (kf)')).toBeTruthy()
  })

  it('keeps the precision each reading has today', () => {
    renderPage()

    // Df to three decimals, Rg in nm to one, porosity as a percentage to one,
    // prefactor to three.
    expect(cardNumbers('Fractal dimension')).toContain('1.823')
    expect(cardNumbers('Radius of gyration')).toContain('300.0')
    expect(metricCard('Radius of gyration')?.textContent).toMatch(/nm/)
    expect(cardNumbers('Porosity')).toContain('41.2')
    expect(metricCard('Porosity')?.textContent).toMatch(/%/)
    expect(cardNumbers('Prefactor (kf)')).toContain('1.700')
  })

  it('shows the fractal dimension uncertainty beside the dimension', () => {
    renderPage()

    // A fractal dimension without its spread is a claim the engine cannot
    // make; the sigma has always been printed as "+/- 0.021".
    expect(cardNumbers('Fractal dimension')).toContain('±0.021')
  })

  it('does not invent readings for a run that has none', () => {
    withSimulation({ status: 'running', metrics: null })
    const { container } = renderPage()

    // A queued run has no Df. Rendering "Df 0.000" would be a claim the engine
    // has not made.
    expect(container.querySelectorAll('article')).toHaveLength(0)
    expect(screen.queryByText('Fractal dimension')).toBeNull()
  })
})

describe('the states a run passes through', () => {
  it('explains a running run in a notice instead of a blank page', () => {
    withSimulation({ status: 'running', metrics: null })
    renderPage()

    expect(screen.getByRole('note').textContent).toMatch(/simulation running/i)
  })

  it('says a queued run is queued, not running', () => {
    withSimulation({ status: 'queued', metrics: null, execution_time_ms: null })
    renderPage()

    // The change moved this state out of a card into a Callout, so the branch
    // that distinguishes queueing from running is exactly the one to pin.
    const notice = screen.getByRole('note').textContent ?? ''
    expect(notice).toMatch(/queued/i)
    expect(notice).not.toMatch(/running/i)
  })

  it('offers to cancel a run that is still going, and cancels it', async () => {
    withSimulation({ status: 'running', metrics: null })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /cancel simulation/i }))

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('p1', 's1'))
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled())
  })

  it('says a cancelled run was cancelled and repeats the reason', () => {
    withSimulation({
      status: 'cancelled',
      metrics: null,
      error_message: 'Cancelled by the operator',
    })
    renderPage()

    const notice = screen.getByRole('note').textContent ?? ''
    expect(notice).toMatch(/simulation cancelled/i)
    expect(notice).toMatch(/cancelled by the operator/i)
  })

  it('reports a failed run as an alert that carries the engine message', () => {
    withSimulation({ status: 'failed', metrics: null, error_message: 'Engine ran out of memory' })
    renderPage()

    // Failure is announced, not merely tinted: a reader on a screen reader
    // must hear that the run failed.
    expect(screen.getByRole('alert').textContent).toMatch(/simulation failed/i)
    expect(screen.getByRole('alert').textContent).toMatch(/engine ran out of memory/i)
  })

  it('does not show readings, or a failure notice, for a run that completed', () => {
    renderPage()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/simulation failed/i)).toBeNull()
    expect(screen.queryByText(/simulation cancelled/i)).toBeNull()
  })
})

describe('the actions on the run', () => {
  it('keeps export, analyse and delete for a completed run', () => {
    renderPage()

    expect(screen.getByRole('button', { name: /export csv/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /analyze projections/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy()
  })

  it('asks before deleting, and deletes only once confirmed', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(mockDelete).not.toHaveBeenCalled()
    expect(screen.getByText(/delete\?/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('p1', 's1'))
  })

  it('keeps the FRAKTAL entry point going to the batch form with this run in hand', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /analyze projections/i }))

    expect(mockPush).toHaveBeenCalledWith('/projects/p1/fraktal/batch?origin=simulation&sim_id=s1')
  })
})

describe('the 3D stage and the values behind it', () => {
  it('gives the scene a titled stage, not a bare canvas', () => {
    withGeometry()
    renderPage()

    // A level-two heading, so the stage sits under the page title rather than
    // competing with it, and the scene itself is on screen.
    const heading = screen.getByRole('heading', { level: 2, name: '3D Visualization' })
    expect(heading).toBeTruthy()
    expect(screen.getByText('viewer')).toBeTruthy()
  })

  it('keeps the values control with the stage title, not loose above the canvas', () => {
    withGeometry()
    renderPage()

    // The toggle belongs to the panel header: a control floating over an
    // unlabelled canvas is the arrangement the kit's header slot exists to
    // prevent.
    const header = viewerPanel().querySelector('header')
    expect(header).not.toBeNull()
    expect(header?.textContent).toMatch(/3D Visualization/)
    expect(header?.querySelector('button')?.textContent).toBe('Show values')
  })

  it('carries the count and the Rg of what is on the stage', () => {
    withGeometry()
    renderPage()

    // Both numbers already exist on the page: two particles were handed to the
    // canvas, and the record's Rg of 12 scales to 300 nm. The stage repeats
    // them so the readings sit on the surface they describe.
    expect(panelNumbers()).toContain('2')
    expect(panelNumbers()).toContain('300.0')
    expect(viewerPanel().textContent).toMatch(/particles/)
    expect(viewerPanel().textContent).toMatch(/nm/)
  })

  it('swaps the scene for the particles behind it, in place', () => {
    withGeometry()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    // The table takes the canvas's position: the stage, its title and its
    // frame stay, and only the thing being inspected changes.
    expect(screen.queryByText('viewer')).toBeNull()
    const table = screen.getByRole('table')
    expect(table).toBeTruthy()
    expect(viewerPanel().contains(table)).toBe(true)
    expect(screen.getByRole('heading', { name: '3D Visualization' })).toBeTruthy()
  })

  it('renames the control and reports its state, instead of hiding what it did', () => {
    withGeometry()
    renderPage()

    const toggle = screen.getByRole('button', { name: 'Show values' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    const back = screen.getByRole('button', { name: 'Show chart' })
    expect(back.getAttribute('aria-pressed')).toBe('true')
  })

  it('tabulates every particle as number, position and radius, in nanometres', () => {
    withGeometry()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    // One header row plus one row per particle the page handed to the viewer —
    // not the 1,200 the record declares, because the table has to match what a
    // reader would otherwise be looking at.
    expect(screen.getAllByRole('row')).toHaveLength(3)

    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent)
    expect(headers).toEqual(['#', 'x', 'y', 'z', 'radius'])

    // Scaled with the record's own factor: 0.1 → 2.5 nm, -0.2 → -5.0 nm,
    // radius 0.06 → 1.5 nm. Raw engine units here would be a unit lie.
    const cells = screen.getAllByRole('cell').map((node) => node.textContent ?? '')
    expect(cells.some((text) => text.includes('2.5'))).toBe(true)
    expect(cells.some((text) => text.includes('-5.0'))).toBe(true)
    expect(cells.some((text) => text.includes('75.0'))).toBe(true)
    expect(cells.some((text) => text.includes('1.5'))).toBe(true)
    expect(viewerPanel().textContent).toMatch(/nm/)
  })

  it('takes the table from the primitive, caption and scroll region included', () => {
    withGeometry()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    // The page configures the table and never assembles one itself, so the
    // caption, the row set and the keyboard-reachable scroll region are the
    // pieces the primitive wires on the page's behalf.
    const caption = /particles behind this view/i
    expect(screen.getByText(caption)).toBeTruthy()
    const region = screen.getByRole('region')
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.getAttribute('aria-label')).toMatch(caption)
    expect(region.contains(screen.getByRole('table'))).toBe(true)
  })

  it('says the stage is empty instead of drawing an empty canvas', () => {
    renderPage()

    // No geometry means no particles to draw. A black rectangle with nothing in
    // it reads as a broken renderer, not as a run with no positions.
    expect(screen.queryByText('viewer')).toBeNull()
    const stage = viewerPanel()
    expect(stage.textContent).toMatch(/nothing to draw/i)
    expect(stage.textContent).toMatch(/particle positions/i)
  })

  it('offers no values table when there are no values to show', () => {
    renderPage()

    // The control is only an offer: an empty table would cost a click to learn
    // nothing.
    expect(screen.queryByRole('button', { name: 'Show values' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
