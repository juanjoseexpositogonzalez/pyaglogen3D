/**
 * The FRAKTAL new-analysis entry page, migrated onto the design-system kit
 * (issue #176, slice 1 of 3).
 *
 * Asserted through what a user can perceive — the heading level, the roles the
 * notices carry, the hrefs of the ways out — rather than through which
 * components were imported. A test that checks imports passes a refactor that
 * breaks the page.
 *
 * The form itself is a neighbour with its own file: it is stubbed here so a
 * failure in this file is about the page and never about the form.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockUseSimulations = vi.fn()
const mockUseCreateFraktalAnalysis = vi.fn()
const mockPush = vi.fn()
const mockFormProps: Array<Record<string, unknown>> = []

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
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
  useCreateFraktalAnalysis: () => mockUseCreateFraktalAnalysis(),
}))

// The deprecated header still exists and eighteen pages import it; this stub
// stands in for it so its presence on the page is observable instead of
// crashing the render on a router the shell already provides.
vi.mock('@/components/layout/Header', () => ({
  Header: () => React.createElement('div', { 'data-testid': 'deprecated-header' }),
}))

// Records its props: a bare stub cannot tell "the page forwards the completed
// simulations" from "the page stopped mounting the form at all".
vi.mock('@/components/fraktal/FraktalAnalysisForm', () => ({
  FraktalAnalysisForm: (props: Record<string, unknown>) => {
    mockFormProps.push(props)
    return React.createElement('form', { 'data-testid': 'fraktal-form' })
  },
}))

import NewFraktalAnalysisPage from '../page'

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Soot aggregates',
  description: 'Tunable Df from 1.6 to 2.4',
  simulation_count: 2,
  analysis_count: 1,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  ...overrides,
})

const simulations = () => ({
  data: {
    results: [
      {
        id: 'sim-done',
        algorithm: 'tunable_cc',
        status: 'completed',
        created_at: '2026-10-02T10:00:00Z',
      },
      {
        id: 'sim-failed',
        algorithm: 'tunable_cc',
        status: 'failed',
        created_at: '2026-10-03T10:00:00Z',
      },
    ],
  },
  isLoading: false,
  error: null,
})

const renderPage = () =>
  render(<NewFraktalAnalysisPage params={{ id: 'p1' }} />)

beforeEach(() => {
  mockUseProject.mockReturnValue({ data: project(), isLoading: false, error: null })
  mockUseSimulations.mockReturnValue(simulations())
  mockUseCreateFraktalAnalysis.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })
  mockFormProps.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FRAKTAL new-analysis page', () => {
  it('leaves the chrome to the shell: no deprecated header and no <main> of its own', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(process.cwd(), 'src/app/projects/[id]/fraktal/new/page.tsx'),
      'utf8',
    )

    // Asserted on the import and on the layout element, not on the absence of
    // `<header>` tags: the kit header renders one legitimately, so counting
    // tags would both fail on a correct page and pass on a wrong one.
    //
    // The shell owns navigation and the page container now. A page that mounts
    // either gets two of them the moment the shell changes.
    expect(source).not.toContain('components/layout/Header')
    expect(source).not.toContain('<main')

    renderPage()
    expect(screen.queryByTestId('deprecated-header')).toBeNull()
  })

  it('names the screen in the kit page header, under the project it belongs to', () => {
    const { container } = renderPage()

    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('New FRAKTAL Analysis')

    // The eyebrow names the method; the description says what the screen does.
    // Exact match: the description mentions FRAKTAL too, but as part of a
    // longer sentence, so it cannot satisfy this assertion by itself.
    expect(screen.getByText('FRAKTAL')).toBeTruthy()
    expect(
      screen.getByText(/Analyze fractal properties of agglomerate images/),
    ).toBeTruthy()

    // A breadcrumb back to the project the analysis will belong to.
    const back = screen.getByText(/Back to Soot aggregates/)
    expect(back.closest('a')?.getAttribute('href')).toBe('/projects/p1')

    expect(container.querySelector('main')).toBeNull()
  })

  it('says a failed project load out loud, as a danger callout with a way back', () => {
    mockUseProject.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('404'),
    })

    renderPage()

    // `role="alert"` is what the kit reserves for state that failed. A panel
    // that merely happens to be red announces nothing.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Failed to load project')
    expect(alert.textContent).toContain('It may not exist or the backend is unavailable')

    const back = screen.getByText('Back to Projects')
    expect(back.closest('a')?.getAttribute('href')).toBe('/projects')
  })

  it('offers the batch route through an informational note, not an alert', () => {
    renderPage()

    // Nothing has failed when this is on screen, so it is a note: an alert
    // here would make a habitual entry point read as a problem.
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('Have a ZIP of projections from a simulation?')
    expect(note.textContent).toContain('for automatic calibration and distribution statistics.')

    const batch = screen.getByText('Try batch analysis')
    expect(batch.closest('a')?.getAttribute('href')).toBe('/projects/p1/fraktal/batch')
  })

  it('hands the form only the completed simulations, and the pending state', () => {
    mockUseCreateFraktalAnalysis.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    })

    renderPage()

    expect(mockFormProps.length).toBe(1)
    const props = mockFormProps[0]
    expect(props.isLoading).toBe(true)
    // A failed run has no geometry to project, so it is not an option.
    expect(props.simulations).toEqual([
      {
        id: 'sim-done',
        algorithm: 'tunable_cc',
        status: 'completed',
        created_at: '2026-10-02T10:00:00Z',
      },
    ])
  })

  it('names a create failure, and keeps the server reason, next to the form', () => {
    mockUseCreateFraktalAnalysis.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('dpo out of range'),
    })

    renderPage()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Failed to create analysis')
    expect(alert.textContent).toContain('dpo out of range')
  })
})
