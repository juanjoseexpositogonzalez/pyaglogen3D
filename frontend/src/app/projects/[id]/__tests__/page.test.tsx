/**
 * Project detail migrated onto the design-system kit (wave 2, issue #174).
 *
 * Guarded slice by slice, following the partition published in the issue. The
 * frame and the counts are slice 1; the simulations list is slice 2. FRAKTAL
 * and its dialogs are slice 3 and get their own guards.
 *
 * Asserted through what a user can perceive — headings, roles, accessible
 * names, hrefs — rather than through which components were imported. A test
 * that checks imports passes a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockUseSimulations = vi.fn()
const mockUseFraktalAnalyses = vi.fn()
const mockUseFraktalBatches = vi.fn()
const mockPush = vi.fn()
const mockDeleteAll = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/projects/p1',
}))

vi.mock('next/link', () => ({
  // A click that the page has not stopped or prevented lands here as a push:
  // otherwise "ticking the checkbox does not navigate" could not fail.
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
  useSimulations: () => mockUseSimulations(),
}))

vi.mock('@/hooks/useFraktalAnalyses', () => ({
  useFraktalAnalyses: () => mockUseFraktalAnalyses(),
  useDeleteFraktalAnalysis: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useFraktalBatches', () => ({
  useFraktalBatches: () => mockUseFraktalBatches(),
}))

vi.mock('@/lib/api', () => ({
  simulationsApi: {
    deleteAll: (...args: unknown[]) => mockDeleteAll(...args),
    delete: vi.fn(),
    cancel: vi.fn(),
  },
  fraktalApi: { deleteAll: vi.fn() },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'demo@pyaglogen3d.dev' }, logout: vi.fn() }),
}))

// Neighbours of another slice: stubbed so a failure in this file is about the
// header and never about a list this slice does not touch.
const mockBatchesProps: Array<Record<string, unknown>> = []
const mockImportDialogProps: Array<Record<string, unknown>> = []

vi.mock('@/components/fraktal/FraktalBatchesSection', () => ({
  // Records its props: a bare stub cannot tell "the page forwards the batches
  // and their error" from "the page stopped mounting the section at all".
  FraktalBatchesSection: (props: Record<string, unknown>) => {
    mockBatchesProps.push(props)
    return React.createElement('div', { 'data-testid': 'batches-section' })
  },
}))

vi.mock('@/components/forms/ImportAggregateDialog', () => ({
  ImportAggregateDialog: (props: Record<string, unknown>) => {
    mockImportDialogProps.push(props)
    return props.open ? React.createElement('div', {}, 'Import aggregate dialog') : null
  },
}))

vi.mock('@/components/banners/UnitConventionBanner', () => ({
  UnitConventionBanner: () => React.createElement('div', {}, 'Unit convention changed'),
}))

import ProjectDetailPage from '../page'

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Soot aggregates',
  description: 'Tunable Df from 1.6 to 2.4',
  simulation_count: 6,
  analysis_count: 2,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  ...overrides,
})

const renderPage = () => render(<ProjectDetailPage params={{ id: 'p1' }} />)

/**
 * The metric card that carries `label`, wherever else the same word appears.
 *
 * "Simulations" is both a count at the top and a section heading further
 * down, so a bare getByText finds two nodes and the test would fail for a
 * reason that has nothing to do with what it checks.
 */
const metricCard = (label: string): HTMLElement | null | undefined =>
  screen
    .getAllByText(label)
    .map((node) => node.closest('article'))
    .find((node) => node !== null)

beforeEach(() => {
  vi.clearAllMocks()
  mockBatchesProps.length = 0
  mockImportDialogProps.length = 0
  mockUseProject.mockReturnValue({ data: project(), isLoading: false, error: null })
  mockUseSimulations.mockReturnValue({ data: { results: [] }, isLoading: false, refetch: vi.fn() })
  mockUseFraktalAnalyses.mockReturnValue({
    data: { results: [] },
    isLoading: false,
    refetch: vi.fn(),
  })
  mockUseFraktalBatches.mockReturnValue({ data: { results: [] }, isLoading: false })
})

describe('the project detail frame', () => {
  it('opens with the project name as the only level-one heading', () => {
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Soot aggregates')
  })

  it('stops mounting the deprecated header', () => {
    const { container } = renderPage()

    // Not "renders no <header>": the kit's own PageHeader is a <header>, so
    // that assertion would fail for the wrong reason. Worth knowing what this
    // proves: rendered outside AppShellProvider the retired Header still draws
    // its navigation, while inside the real shell it renders nothing — so this
    // guards the import, not the experience. Kept because a page growing its
    // own navigation is worth catching either way.
    expect(container.querySelector('nav')).toBeNull()
  })

  it('leaves the page frame to the shell instead of nesting its own main', () => {
    const { container } = renderPage()

    // AppShell owns <main>: it is the element that carries the 1440px measure
    // and the shell padding. A page rendering a second one nests two scroll
    // containers and double-pads at every width.
    expect(container.querySelector('main')).toBeNull()
  })

  it('says it is loading while the project request is in flight', () => {
    mockUseProject.mockReturnValue({ data: undefined, isLoading: true, error: null })
    renderPage()

    expect(screen.getByText(/loading project/i)).toBeTruthy()
  })

  it('reports a failed load instead of pretending the project is empty', () => {
    mockUseProject.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') })
    renderPage()

    // A project that failed to load and a project with nothing in it must not
    // look alike: the second is a legitimate starting point, the first is a
    // lost workspace.
    expect(screen.getByRole('alert').textContent).toMatch(/failed to load project/i)
    expect(screen.queryByText(/no simulations yet/i)).toBeNull()
  })

  it('offers the way back to the list it came from', () => {
    renderPage()

    expect(screen.getByRole('link', { name: /back to projects/i }).getAttribute('href')).toBe(
      '/projects',
    )
  })

  it('shows the description when there is one and omits it when there is not', () => {
    renderPage()
    expect(screen.getByText('Tunable Df from 1.6 to 2.4')).toBeTruthy()

    mockUseProject.mockReturnValue({
      data: project({ description: null }),
      isLoading: false,
      error: null,
    })
    const { container } = renderPage()
    expect(container.textContent).not.toMatch(/tunable df/i)
  })
})

describe('the project counts', () => {
  it('names each count on its own metric card', () => {
    renderPage()

    expect(metricCard('Simulations')).toBeTruthy()
    expect(metricCard('Analyses')).toBeTruthy()
  })

  it('renders both counts as whole numbers, with no decimal point at all', () => {
    renderPage()

    // `MetricCard` passes `digits={3}`, so dropping `digits={0}` would render
    // "6.000". Scoped to the card rather than to the document: slice 2 puts
    // real decimal readings (Df, Rg) further down the same page.
    expect(metricCard('Simulations')?.querySelector('.num')?.textContent).toBe('6')
    expect(metricCard('Analyses')?.querySelector('.num')?.textContent).toBe('2')
  })

  it('says the analysis count covers both kinds, because the backend adds them', () => {
    renderPage()

    // `Project.analysis_count` is ImageAnalysis plus FraktalAnalysis. Labelling
    // it "FRAKTAL analyses" — as the reference design does — would promise a
    // narrower number than the field returns.
    expect(metricCard('Analyses')?.textContent).toMatch(/image/i)
    expect(metricCard('Analyses')?.textContent).toMatch(/fraktal/i)
  })

  it('keeps the four ways into the project', () => {
    renderPage()

    expect(
      screen.getByRole('link', { name: 'Batch Simulations' }).getAttribute('href'),
    ).toBe('/projects/p1/batch')
    expect(
      screen.getByRole('link', { name: 'FRAKTAL Analysis' }).getAttribute('href'),
    ).toBe('/projects/p1/fraktal/new')
    expect(
      screen.getByRole('link', { name: 'New Simulation' }).getAttribute('href'),
    ).toBe('/projects/p1/simulations/new')
    expect(screen.getByRole('button', { name: 'Import Aggregate' })).toBeTruthy()
  })
})

const sim = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  project: 'p1',
  name: 'Baseline run',
  algorithm: 'tunable_cc',
  status: 'completed',
  // 50 nm diameter makes the Rg scale an exact 25, so the expected reading is
  // arithmetic rather than whatever the fixture happens to produce.
  parameters: { primary_particle_diameter_nm: 50, n_particles: 1200 },
  seed: 42,
  metrics: { fractal_dimension: 1.8234, radius_of_gyration: 12 },
  execution_time_ms: 1200,
  created_at: '2026-10-20T10:00:00Z',
  completed_at: '2026-10-20T10:01:00Z',
  ...overrides,
})

const withSimulations = (...sims: unknown[]) =>
  mockUseSimulations.mockReturnValue({ data: { results: sims }, isLoading: false, refetch: vi.fn() })

describe('the simulations section', () => {
  it('names the section, so the list is reachable by heading', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: 'Simulations' })).toBeTruthy()
  })

  it('lists one entry per simulation, each linking to it', () => {
    withSimulations(sim(), sim({ id: 's2', name: 'High Df' }))
    renderPage()

    expect(screen.getByRole('link', { name: /baseline run/i }).getAttribute('href')).toBe(
      '/projects/p1/simulations/s1',
    )
    expect(screen.getByRole('link', { name: /high df/i }).getAttribute('href')).toBe(
      '/projects/p1/simulations/s2',
    )
  })

  it('says what state a run is in, in words', () => {
    withSimulations(sim(), sim({ id: 's2', name: 'Broke', status: 'failed', metrics: null }))
    renderPage()

    // Status is never colour alone: the chip carries the word.
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('shows the readings a completed run produced, with their units', () => {
    withSimulations(sim())
    const { container } = renderPage()

    const readings = container.querySelectorAll('.num')
    const texts = Array.from(readings).map((node) => node.textContent)
    // Df at three decimals and Rg scaled to nm at one: 12 × 25 = 300.
    expect(texts).toContain('1.823')
    expect(texts).toContain('300.0')
    expect(screen.getByText('nm')).toBeTruthy()
  })

  it('counts particles as whole numbers, not as a rounded decimal', () => {
    withSimulations(sim())
    const { container } = renderPage()

    const texts = Array.from(container.querySelectorAll('.num')).map((node) => node.textContent)
    expect(texts).toContain('1,200')
  })

  it('does not invent readings for a run that has none', () => {
    withSimulations(sim({ status: 'running', metrics: null }))
    renderPage()

    // A queued run has no Df. Rendering "Df 0.000" would be a claim the engine
    // has not made.
    expect(screen.queryByText('Df')).toBeNull()
  })

  it('offers an empty state that says what the surface is for', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: /no simulations yet/i })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /run simulation/i }).getAttribute('href'),
    ).toBe('/projects/p1/simulations/new')
  })

  it('reports a failed list instead of pretending there are no runs', () => {
    mockUseSimulations.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByRole('alert').textContent).toMatch(/failed to load simulations/i)
    expect(screen.queryByText(/no simulations yet/i)).toBeNull()
  })

  it('keeps the compare checkbox, and ticking it does not navigate', () => {
    withSimulations(sim())
    renderPage()

    const box = screen.getByRole('checkbox', { name: /select baseline run/i }) as HTMLInputElement
    fireEvent.click(box)

    // The click that selects is the click that must not open the run: the
    // checkbox lives inside the card's link.
    expect(box.checked).toBe(true)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('offers to compare only once two runs are selected', () => {
    withSimulations(sim(), sim({ id: 's2', name: 'High Df', algorithm: 'gcca' }))
    renderPage()

    expect(screen.queryByRole('region', { name: /compare simulations/i })).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: /select baseline run/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /select high df/i }))

    expect(screen.getByRole('region', { name: /compare simulations/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /compare \(2\)/i }))
    expect(mockPush).toHaveBeenCalledWith('/projects/p1/compare?sims=s1,s2')
  })

  it('asks before deleting every run and deletes them only when confirmed', async () => {
    mockDeleteAll.mockResolvedValue(undefined)
    withSimulations(sim(), sim({ id: 's2', name: 'High Df' }))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /delete all/i }))
    expect(screen.getByText(/delete all 2 simulations\?/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockDeleteAll).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /delete all/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete all/i }))

    // Confirmation stays in line rather than in a native confirm(): the
    // pattern this screen already had and #178 shows the list lacks.
    await waitFor(() => expect(mockDeleteAll).toHaveBeenCalledWith('p1'))
  })
})

const analysis = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  project: 'p1',
  model: 'granulated_2012',
  source_type: 'uploaded_image',
  status: 'completed',
  results: { df: 1.7456, npo: 1234 },
  created_at: '2026-10-20T10:00:00Z',
  ...overrides,
})

const withAnalyses = (...analyses: unknown[]) =>
  mockUseFraktalAnalyses.mockReturnValue({
    data: { results: analyses },
    isLoading: false,
    refetch: vi.fn(),
  })

describe('the FRAKTAL analyses section', () => {
  it('names the section, so it is reachable by heading', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: 'FRAKTAL analyses' })).toBeTruthy()
  })

  it('lists one entry per analysis, naming its model and its source', () => {
    withAnalyses(analysis(), analysis({ id: 'a2', model: 'voxel_2018', source_type: 'projection' }))
    renderPage()

    expect(screen.getByRole('link', { name: /granulated 2012/i }).getAttribute('href')).toBe(
      '/projects/p1/fraktal/a1',
    )
    expect(screen.getByRole('link', { name: /voxel 2018/i }).getAttribute('href')).toBe(
      '/projects/p1/fraktal/a2',
    )
    expect(screen.getByText('Image')).toBeTruthy()
    expect(screen.getByText('Projection')).toBeTruthy()
  })

  it('says what state an analysis is in, in words', () => {
    withAnalyses(analysis(), analysis({ id: 'a2', status: 'failed', results: null }))
    renderPage()

    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('shows the readings a finished analysis produced', () => {
    withAnalyses(analysis())
    const { container } = renderPage()

    const texts = Array.from(container.querySelectorAll('.num')).map((node) => node.textContent)
    expect(texts).toContain('1.746')
    // Number of primary particles: a count, so no decimals at all.
    expect(texts).toContain('1,234')
  })

  it('does not invent readings for an analysis that has none', () => {
    withAnalyses(analysis({ status: 'running', results: null }))
    renderPage()

    expect(screen.queryByText('Df')).toBeNull()
    expect(screen.queryByText('Npo')).toBeNull()
  })

  it('offers an empty state that says what an analysis is for', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: /no fraktal analyses yet/i })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /run fraktal analysis/i }).getAttribute('href'),
    ).toBe('/projects/p1/fraktal/new')
  })

  it('reports a failed analyses list instead of pretending there are none', () => {
    mockUseFraktalAnalyses.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch: vi.fn(),
    })
    renderPage()

    const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '')
    expect(alerts.some((text) => /failed to load fraktal analyses/i.test(text))).toBe(true)
    expect(screen.queryByText(/no fraktal analyses yet/i)).toBeNull()
  })

  it('confirms in line before deleting an analysis, and cancelling keeps it', () => {
    withAnalyses(analysis())
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /delete fraktal analysis/i }))
    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
  })
})

describe('the findings the two judges left open', () => {
  it('says the count includes batch runs, which the list below it does not', () => {
    withSimulations(sim())
    renderPage()

    // `Project.simulation_count` counts every simulation, batch included; the
    // list endpoint filters `is_batch=False`. A card that says "Simulations 42"
    // over a list of single runs needs the difference said out loud.
    expect(metricCard('Simulations')?.textContent).toMatch(/batch/i)
  })

  it('keeps the rows on screen when a background refetch fails', () => {
    mockUseSimulations.mockReturnValue({
      data: { results: [sim()] },
      isLoading: false,
      error: new Error('blip'),
      refetch: vi.fn(),
    })
    renderPage()

    // The rows were readable a moment ago and are still in cache. Replacing
    // them with "this page could not read them" is a worse lie than showing
    // stale rows with no notice.
    expect(screen.getByRole('link', { name: /baseline run/i })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names every control in a row after the run it acts on', () => {
    withSimulations(sim(), sim({ id: 's2', name: 'Low density sweep' }))
    renderPage()

    // Two runs of the same algorithm are the normal case: a control named
    // after the algorithm names nothing.
    expect(screen.getByRole('button', { name: 'Delete Baseline run' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Low density sweep' })).toBeTruthy()
    expect(
      screen.getByRole('checkbox', { name: 'Select Low density sweep for comparison' }),
    ).toBeTruthy()
  })

  it('opens the import dialog from the header action', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Import Aggregate' }))

    // The dialog stub renders only when it is told to open, so this asserts the
    // wiring rather than the presence of a button nobody pressed.
    expect(screen.getByText('Import aggregate dialog')).toBeTruthy()
    expect(mockImportDialogProps.at(-1)?.open).toBe(true)
  })

  it('tells the batches section which project it belongs to, and about a failure', () => {
    const batches = [{ id: 'b1', status: 'completed', n_images: 2 }]
    mockUseFraktalBatches.mockReturnValue({ data: { results: batches }, isLoading: false })
    renderPage()
    expect(mockBatchesProps.at(-1)?.projectId).toBe('p1')
    expect(mockBatchesProps.at(-1)?.batches).toEqual(batches)

    mockUseFraktalBatches.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    })
    renderPage()
    // A section that is never told about the failure cannot tell a 5xx from an
    // empty project.
    expect(mockBatchesProps.at(-1)?.error).toBeTruthy()
  })
})
