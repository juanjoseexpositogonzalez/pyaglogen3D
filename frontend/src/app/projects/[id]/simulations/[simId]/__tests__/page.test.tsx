/**
 * Simulation detail migrated onto the design-system kit (issue #180, slice 1).
 *
 * This slice is the header, the identity row and the headline readings. The 3D
 * viewer, the projections, the topology graph, the optical section, the
 * parameters table and the FRAKTAL dialog belong to slices 2 and 3 and are
 * stubbed here, so a failure in this file is about the header and never about a
 * neighbour.
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
  useSimulationGeometry: () => ({ data: undefined }),
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

// Neighbours owned by later slices, and by the shell. Stubbed so a three.js
// canvas or a plotly chart cannot decide whether the header is correct.
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

beforeEach(() => {
  vi.clearAllMocks()
  mockExportCsv.mockResolvedValue(new Blob(['a,b']))
  mockCancel.mockResolvedValue(undefined)
  mockDelete.mockResolvedValue(undefined)
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
    expect(headings[0].textContent).toMatch(/tunable_cc/i)
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
    // A run still in the queue has no measured duration. An em dash in the
    // identity row would read as "took no time", which is a different claim.
    withSimulation({ status: 'running', metrics: null, execution_time_ms: null })
    renderPage()

    expect(pageHeader().textContent).not.toMatch(/—/)
  })
})

describe('the readings of a completed run', () => {
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
