/**
 * Project detail migrated onto the design-system kit (wave 2, issue #174).
 *
 * This file guards **slice 1** of the partition published in the issue: the
 * header, the counts, and the removal of the deprecated layout header. The
 * simulations and FRAKTAL sections are slices 2 and 3 and get their own
 * guards; a failure here means the top of the screen moved, not the lists.
 *
 * Asserted through what a user can perceive — headings, roles, accessible
 * names, hrefs — rather than through which components were imported. A test
 * that checks imports passes a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockUseSimulations = vi.fn()
const mockUseFraktalAnalyses = vi.fn()
const mockUseFraktalBatches = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/projects/p1',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'demo@pyaglogen3d.dev' }, logout: vi.fn() }),
}))

// Neighbours of another slice: stubbed so a failure in this file is about the
// header and never about a list this slice does not touch.
vi.mock('@/components/fraktal/FraktalBatchesSection', () => ({
  FraktalBatchesSection: () => React.createElement('div', { 'data-testid': 'batches-section' }),
}))

vi.mock('@/components/forms/ImportAggregateDialog', () => ({
  ImportAggregateDialog: () => null,
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

    // `Num` defaults to two decimals, so dropping `digits={0}` would render
    // "6.00". Scoped to the card rather than to the document: slice 2 puts
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
