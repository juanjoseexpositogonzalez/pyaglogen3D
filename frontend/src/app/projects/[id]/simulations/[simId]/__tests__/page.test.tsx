/**
 * Simulation detail migrated onto the design-system kit (issue #180).
 *
 * Slice 1 is the header, the identity row and the headline readings; slice 2 is
 * the 3D stage and the values behind it; slice 3 is the analysis blocks and
 * their tables. The projections, the analysis charts and the topology graph are
 * stubbed here, so a failure in this file is about the surfaces this file owns
 * and never about a neighbour this file only wraps.
 *
 * Asserted through what a user can perceive — headings, roles, accessible
 * names, hrefs and the rendered numbers — rather than through which components
 * were imported. A test that checks imports passes a refactor that breaks the
 * page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockUseSimulation = vi.fn()
const mockUseSimulationGeometry = vi.fn()
const mockViewerProps = vi.fn()
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
// itself is stubbed too: this file asserts where it is mounted, what it is
// handed and when it is replaced, not what three.js paints.
vi.mock('@/components/viewer3d/AgglomerateViewer', () => ({
  AgglomerateViewer: (props: Record<string, unknown>) => {
    mockViewerProps(props)
    return React.createElement('div', {}, 'viewer')
  },
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

type GeometryState = { isLoading?: boolean; isError?: boolean }

const withGeometry = (data: unknown = geometry(), state: GeometryState = {}) =>
  mockUseSimulationGeometry.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    ...state,
  })

/** `count` particles in dimensionless units, all on the x axis. */
const manyParticles = (count: number) =>
  geometry({
    coordinates: Array.from({ length: count }, (_, i) => [i * 0.01, 0, 0]),
    radii: Array.from({ length: count }, () => 0.04),
  })

const withSimulation = (overrides: Record<string, unknown> = {}) =>
  mockUseSimulation.mockReturnValue({
    data: simulation(overrides),
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })

/**
 * Four sampled Rg values on a 1,200-particle run. The plot's sampling step is
 * totalParticles / length = 300, so the expected N column is 300, 600, 900 and
 * 1,200 — arithmetic rather than whatever the fixture happens to produce.
 */
const withRgEvolution = (rgEvolution: number[] = [1.2, 2.4, 3.6, 4.8]) =>
  withSimulation({
    metrics: { ...simulation().metrics, rg_evolution: rgEvolution },
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
  screen.getByRole('heading', { name: '3D visualization' }).closest('section') as HTMLElement

/**
 * A kit panel, reached from its own level-two title. Panels are `<section>`s, so
 * the closest one is the frame the title belongs to.
 */
const panelByTitle = (title: string): HTMLElement =>
  screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement

/** Every reading inside a surface, in document order. */
const numbersIn = (element: HTMLElement): string[] =>
  Array.from(element.querySelectorAll('.num')).map((node) => node.textContent ?? '')

/** The numbers rendered inside the 3D stage, in document order. */
const panelNumbers = (): string[] =>
  Array.from(viewerPanel().querySelectorAll('.num')).map((node) => node.textContent ?? '')

beforeEach(() => {
  vi.clearAllMocks()
  mockExportCsv.mockResolvedValue(new Blob(['a,b']))
  mockCancel.mockResolvedValue(undefined)
  mockDelete.mockResolvedValue(undefined)
  // No geometry by default, and none of it in flight or failed: this record
  // has no particle positions. That is the empty stage, not a blank canvas.
  mockUseSimulationGeometry.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  })
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
    const heading = screen.getByRole('heading', { level: 2, name: '3D visualization' })
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
    expect(header?.textContent).toMatch(/3D visualization/)
    expect(header?.querySelector('button')?.textContent).toBe('Show values')
  })

  it('carries the count and the Rg of what is on the stage', () => {
    withGeometry()
    renderPage()

    // Both numbers already exist on the page: two particles were handed to the
    // canvas, and the record's Rg of 12 scales to 300 nm. The stage repeats
    // them so the readings sit on the surface they describe — and the count is
    // labelled by where it came from, because the header counts the record's
    // `n_particles` (1,200 here) and two unlabelled counts would contradict
    // each other on screen.
    expect(panelNumbers()).toContain('2')
    expect(panelNumbers()).toContain('300.0')
    expect(viewerPanel().textContent).toMatch(/in geometry/i)
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
    expect(screen.getByRole('heading', { name: '3D visualization' })).toBeTruthy()
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

  it('sits the values table on paper instead of on the dark canvas', () => {
    withGeometry()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    // The stage is near-black in both themes, so cells painted in `--ink`
    // measured 1.29:1 there and the caption 3.3:1 — under AA, for the exact
    // reader the table exists for. `DataTable` is correct on a paper surface;
    // the surface is what the page owes it.
    const table = screen.getByRole('table')
    const surface = table.closest('.bg-surface-strong')
    expect(surface).not.toBeNull()
    expect(viewerPanel().contains(surface)).toBe(true)
    // Still inside the stage: the frame, the title and the readings stay.
    expect(viewerPanel().contains(table)).toBe(true)
  })

  it('leaves the last row of the table above the readings bar', () => {
    withGeometry()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    // The caption bar is absolute inside the stage: ~35px tall, 12px off the
    // bottom edge. A table allowed to fill the stage scrolls its last row under
    // the bar, so the cap has to leave that room — and the bar's own backdrop
    // stays dark, which is the contrast the readings were toned for.
    const stage = viewerPanel().querySelector('.bg-visual') as HTMLElement
    const region = screen.getByRole('region')
    const stageHeight = Number.parseFloat(stage.style.height)
    const tableHeight = Number.parseFloat(region.style.maxHeight)

    expect(stageHeight).toBe(600)
    expect(tableHeight).toBeLessThan(stageHeight)
    expect(stageHeight - tableHeight).toBeGreaterThanOrEqual(40)
  })

  it('caps the rows it paints and says in the caption what it left out', () => {
    // The serializer accepts up to 100,000 particles; painting them all stalls
    // the page. A bounded head is fine, a silent one is not: the caption is the
    // only thing that says the table is not the whole run.
    withGeometry(manyParticles(600))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    // one header row plus the cap
    expect(screen.getAllByRole('row')).toHaveLength(501)
    expect(screen.getByText(/first 500 of 600 particles/i)).toBeTruthy()
  })

  it('does not claim a truncation that did not happen', () => {
    withGeometry()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    expect(viewerPanel().textContent).not.toMatch(/first \d+ of/i)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('says the positions are still arriving instead of showing an empty stage', () => {
    // Nothing has failed and nothing is missing: the payload is in flight, and
    // "nothing to draw" would be a claim about the run rather than about the
    // request.
    withGeometry(undefined, { isLoading: true })
    renderPage()

    const stage = viewerPanel()
    expect(stage.textContent).toMatch(/reading particle positions/i)
    expect(stage.textContent).not.toMatch(/nothing to draw/i)
    expect(screen.queryByText('viewer')).toBeNull()
  })

  it('reports a geometry failure as a notice, not as an empty stage', () => {
    withGeometry(undefined, { isError: true })
    renderPage()

    const notice = screen.getByRole('alert')
    expect(notice.textContent).toMatch(/particle positions/i)
    expect(notice.textContent).toMatch(/could not be loaded/i)
    expect(viewerPanel().textContent).not.toMatch(/nothing to draw/i)
  })

  it('hands the viewer the geometry scaled to nm and the record principal axes', () => {
    withGeometry()
    renderPage()

    const props = mockViewerProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    const coordinates = props.coordinates as number[][]
    const radii = props.radii as number[]

    // The page exports `principalAxes` so the stage's render-prop body can use
    // it; without this witness that refactor is invisible to the suite.
    expect(coordinates).toHaveLength(2)
    expect(coordinates[0].map((n) => Number(n.toFixed(6)))).toEqual([2.5, -5, 10])
    expect(coordinates[1]).toEqual([25, 50, 75])
    expect(radii.map((r) => Number(r.toFixed(6)))).toEqual([1, 1.5])
    expect(props.principalAxes).toEqual(simulation().metrics.principal_axes)
  })

  it('reads the caption bar in the tone the dark stage provides', () => {
    withGeometry()
    renderPage()

    // The bar is glass over a near-black canvas: paper ink there measured
    // 1.29:1. The tokens are pinned here; the ratio is measured in a browser.
    const stage = viewerPanel()
    expect(stage.querySelector('.num.text-ink-on-dark')).not.toBeNull()
    expect(stage.querySelector('.num-unit.text-ink-on-dark-faint')).not.toBeNull()
    expect(stage.querySelector('.num.text-ink')).toBeNull()
  })
})

describe('the analysis blocks on the kit', () => {
  it('reads the coordination numbers as a labelled pair', () => {
    renderPage()

    // Two readings named in a definition list, not a paragraph of numbers with
    // a heading over them: mean 2.345 to two decimals, spread 0.51.
    const panel = panelByTitle('Coordination number')
    expect(numbersIn(panel)).toEqual(['2.35', '0.51'])
    expect(panel.textContent).toMatch(/mean/i)
    expect(panel.textContent).toMatch(/std\. dev\./i)
  })

  it('keeps the shape readings, and says which form the anisotropy implies', () => {
    renderPage()

    const panel = panelByTitle('Shape analysis')
    const numbers = numbersIn(panel)
    expect(numbers).toContain('1.20')
    expect(numbers).toContain('0.051')
    expect(numbers).toContain('0.024')
    // The principal moments keep their one decimal, under labels that say what
    // they are once the card's sub-heading is gone.
    expect(numbers).toContain('10.4')
    expect(numbers).toContain('20.9')
    expect(numbers).toContain('30.1')
    expect(panel.textContent).toMatch(/principal moment/i)
    // 1.2 is below 1.5, so the reading still says "Compact" in words: a shape
    // verdict carried by a number alone is not a verdict a reader can check.
    expect(panel.textContent).toMatch(/compact/i)
  })

  it('puts the box-counting analysis in a kit panel', () => {
    renderPage()

    const panel = panelByTitle('Box counting')
    expect(panel.textContent).toMatch(/box counting/i)
  })

  it('names the limiting cases on a panel of their own', () => {
    renderPage()

    // The block carries the overlay control that drives the scaling plot, so it
    // stays open: a disclosure would hide the switch that makes the lines
    // appear.
    const panel = panelByTitle('Limiting cases')
    expect(panel.textContent).toMatch(/limiting cases/i)
  })

  it('puts the 2D projection on the dark stage and leaves its controls beside it', () => {
    renderPage()

    const panel = panelByTitle('2D projection')
    const stage = panel.querySelector('.bg-visual') as HTMLElement
    expect(stage).not.toBeNull()
    expect(stage.textContent).toMatch(/projection viewer/)
    // Generation and download are not this slice's business: the controls keep
    // their column, outside the stage.
    expect(stage.textContent).not.toMatch(/projection controls/)
    expect(screen.getByText('projection controls')).toBeTruthy()
  })

  it('puts the topology graph on the dark stage', () => {
    renderPage()

    const stage = panelByTitle('Topology').querySelector('.bg-visual') as HTMLElement
    expect(stage).not.toBeNull()
    expect(stage.textContent).toMatch(/neighbor graph/)
  })

  it('puts the optical properties in a kit panel', () => {
    renderPage()

    const panel = panelByTitle('Optical properties')
    expect(panel.textContent).toMatch(/optical/i)
  })

  it('recaps the run parameters as a labelled list, with the numbers through Num', () => {
    renderPage()

    const panel = panelByTitle('Simulation parameters')
    // The wire keys read as words, and the values keep the digits the record
    // holds: 1,200 grouped and 50 as a whole number, not 1200.00 and 50.00.
    expect(panel.textContent).toMatch(/primary particle diameter nm/i)
    expect(numbersIn(panel)).toContain('1,200')
    expect(numbersIn(panel)).toContain('50')
  })

  it('encodes a nested parameter instead of printing an object', () => {
    withSimulation({
      parameters: {
        primary_particle_diameter_nm: 50,
        n_particles: 1200,
        import_metadata: { source: 'micrograph' },
      },
    })
    renderPage()

    const panel = panelByTitle('Simulation parameters')
    expect(panel.textContent).toContain('{"source":"micrograph"}')
    expect(panel.textContent).not.toContain('[object Object]')
  })

  it('leaves the retired card surface out of its own markup', () => {
    const { container } = renderPage()

    // `bg-card` is the shadcn card surface, and the kit's panels carry their own
    // tokens. A page that still mounts one nests a legacy frame inside a kit
    // panel, which is what this slice exists to remove. The neighbours this file
    // stubs still paint their own cards until their own slices migrate them.
    expect(container.querySelector('[class*="bg-card"]')).toBeNull()
  })
})

describe('the values behind the scaling plot', () => {
  it('names the scaling plot, and offers the numbers behind it', () => {
    withRgEvolution()
    renderPage()

    // A level-two heading, so the plot sits under the page title, and the
    // control lives in the panel header rather than floating over the chart.
    const panel = panelByTitle('Fractal scaling')
    expect(within(panel).getByRole('button', { name: 'Show values' })).toBeTruthy()
  })

  it('tabulates the Rg/rp pairs behind the plot, and the fitted line', () => {
    withRgEvolution()
    renderPage()

    fireEvent.click(within(panelByTitle('Fractal scaling')).getByRole('button', { name: 'Show values' }))

    const table = within(panelByTitle('Fractal scaling')).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      'N',
      'Rg/rp',
      'N (fit)',
    ])
    // One header row plus one row per sampled Rg. The N column carries the
    // sampling step the chart drew (1,200 particles over four samples), so the
    // table and the axis count the same run.
    expect(within(table).getAllByRole('row')).toHaveLength(5)

    const cells = within(table).getAllByRole('cell').map((node) => node.textContent ?? '')
    expect(cells).toContain('300')
    expect(cells).toContain('1,200')
    expect(cells).toContain('1.200')
    expect(cells).toContain('4.800')
    // The fit the chart draws: N = kf·(Rg/rp)^Df, evaluated at the first point
    // with the run's own kf and Df. Without it the table would show the points
    // the line passes through and never the line.
    const fitted = (1.7 * Math.pow(1.2, 1.8234)).toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
    expect(cells).toContain(fitted)
  })

  it('leaves out the points the chart cannot plot', () => {
    // The plot drops ratios under 0.1 before it takes a logarithm. A table that
    // kept them would print rows the chart never drew, and a reader comparing
    // the two would conclude the plot had lost data.
    withRgEvolution([0.05, 1.2, 2.4])
    renderPage()

    fireEvent.click(within(panelByTitle('Fractal scaling')).getByRole('button', { name: 'Show values' }))

    const table = within(panelByTitle('Fractal scaling')).getByRole('table')
    // One header row plus the two points that clear the floor.
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    const cells = within(table).getAllByRole('cell').map((node) => node.textContent ?? '')
    expect(cells).not.toContain('0.050')
    // 1,200 particles over three samples is a step of 400, and the dropped
    // first point takes its N with it: the kept points are 800 and 1,200.
    expect(cells).toContain('800')
    expect(cells).toContain('1,200')
  })

  it('says what the fitted column is, and where its exponent came from', () => {
    withRgEvolution()
    renderPage()

    fireEvent.click(within(panelByTitle('Fractal scaling')).getByRole('button', { name: 'Show values' }))

    expect(screen.getByText(/with the fitted N from the run's Df and kf/i)).toBeTruthy()
  })

  it('keeps the panel frame, its title and its control when the table takes the plot', () => {
    withRgEvolution()
    renderPage()

    fireEvent.click(within(panelByTitle('Fractal scaling')).getByRole('button', { name: 'Show values' }))

    // The chart is gone and the table sits where it was, inside the same panel:
    // the title, the frame and the control stay put.
    expect(screen.queryByText('fractal plot')).toBeNull()
    const panel = panelByTitle('Fractal scaling')
    expect(within(panel).getByRole('table')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Show chart' })).toBeTruthy()
  })

  it('keeps each values control with the panel it belongs to', () => {
    withGeometry()
    withRgEvolution()
    renderPage()

    // Two visuals on one page now offer a table. Reaching one by name alone
    // would be ambiguous, and a control that swaps the wrong panel would be a
    // bug the name-based queries above cannot see.
    fireEvent.click(within(panelByTitle('Fractal scaling')).getByRole('button', { name: 'Show values' }))

    expect(within(panelByTitle('Fractal scaling')).getByRole('table')).toBeTruthy()
    expect(within(viewerPanel()).queryByRole('table')).toBeNull()
    expect(screen.getByText('viewer')).toBeTruthy()
    expect(within(viewerPanel()).getByRole('button', { name: 'Show values' })).toBeTruthy()
  })

  it('offers no values table when the run recorded no evolution', () => {
    renderPage()

    // No `rg_evolution` means no plot and nothing to tabulate. A panel with an
    // empty table would cost a click to learn nothing.
    expect(screen.queryByRole('heading', { name: 'Fractal scaling' })).toBeNull()
    expect(screen.queryByText(/with the fitted N/i)).toBeNull()
  })
})
