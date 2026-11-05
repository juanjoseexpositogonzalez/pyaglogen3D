/**
 * The new-simulation entry page, migrated onto the design-system kit
 * (issue #181, slice 1 of 3).
 *
 * Asserted through what a user can perceive — the heading level, the way back,
 * the loading message — rather than through which components were imported. A
 * test that checks imports passes a refactor that breaks the page.
 *
 * The form itself is a neighbour with its own file and its own tests: it is
 * stubbed here, recording the props the page hands it, so a failure in this
 * file is about the page and never about the form.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockMutateAsync = vi.fn()
const mockUseCreateSimulation = vi.fn()
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
  useCreateSimulation: () => mockUseCreateSimulation(),
}))

// The deprecated header still exists and eighteen pages import it; this stub
// stands in for it so its presence on the page is observable instead of
// crashing the render on a router the shell already provides.
vi.mock('@/components/layout/Header', () => ({
  Header: () => React.createElement('div', { 'data-testid': 'deprecated-header' }),
}))

// Records its props: a bare stub cannot tell "the page forwards the pending
// state" from "the page stopped mounting the form at all".
vi.mock('@/components/forms/SimulationForm', () => ({
  SimulationForm: (props: Record<string, unknown>) => {
    mockFormProps.push(props)
    return React.createElement(
      'form',
      { 'data-testid': 'simulation-form' },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () =>
            (props.onSubmit as (data: unknown) => void)({
              algorithm: 'tunable_cc',
              n_particles: 20000,
            }),
        },
        'Submit simulation',
      ),
    )
  },
}))

import NewSimulationPage from '../page'

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

const renderPage = () => render(<NewSimulationPage params={{ id: 'p1' }} />)

beforeEach(() => {
  mockUseProject.mockReturnValue({ data: project(), isLoading: false })
  mockMutateAsync.mockResolvedValue({ id: 'sim-42' })
  mockUseCreateSimulation.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })
  mockFormProps.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('new-simulation page', () => {
  it('does not mount the deprecated header', () => {
    renderPage()

    expect(screen.queryByTestId('deprecated-header')).toBeNull()
  })

  it('keeps its column at the width the other creation screens use, and draws no main of its own', () => {
    const { container } = renderPage()

    // The shell owns `<main>`. A second one on the route gives the document two
    // main landmarks and makes the skip link land on the inner one.
    expect(container.querySelector('main')).toBeNull()

    const column = container.querySelector('.max-w-2xl')
    expect(column).toBeTruthy()
    expect(column!.contains(screen.getByTestId('simulation-form'))).toBe(true)
    // The heading belongs to the same column as the form: a title that spans
    // the shell over a capped form reads as two screens.
    expect(column!.textContent).toContain('New Simulation')
  })

  it('names the screen in the kit page header and heads back to its project', () => {
    renderPage()

    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('New Simulation')

    // The eyebrow names the object being created, as on the simulation detail
    // page; the description says what the run is.
    expect(screen.getByText('SIMULATION')).toBeTruthy()
    expect(screen.getByText('Configure and run a 3D agglomerate simulation')).toBeTruthy()

    const back = screen.getByText(/Back to Soot aggregates/)
    expect(back.closest('a')?.getAttribute('href')).toBe('/projects/p1')
  })

  it('names the project generically when the project has not arrived', () => {
    mockUseProject.mockReturnValue({ data: undefined, isLoading: false })

    renderPage()

    // The way back still points at the project route even when its name is
    // unknown, so the page never strands a reader on a broken run.
    const back = screen.getByText(/Back to Project$/)
    expect(back.closest('a')?.getAttribute('href')).toBe('/projects/p1')
  })

  it('shows the loading message instead of an empty form while the project loads', () => {
    mockUseProject.mockReturnValue({ data: undefined, isLoading: true })

    const { container } = renderPage()

    expect(screen.getByText('Loading...')).toBeTruthy()
    expect(screen.queryByTestId('simulation-form')).toBeNull()
    expect(screen.queryByTestId('deprecated-header')).toBeNull()
    // The loading branch is a whole render of this route: it must not bring the
    // document frame back either.
    expect(container.querySelector('main')).toBeNull()
  })

  it('hands the form the pending state of the create request', () => {
    mockUseCreateSimulation.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
    })

    renderPage()

    expect(mockFormProps.length).toBe(1)
    expect(mockFormProps[0].isLoading).toBe(true)
  })

  it('creates the simulation and opens the run it produced', async () => {
    renderPage()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit simulation' }))
    })

    // The page forwards the form's payload untouched: defaults, validation and
    // payload shape belong to the form, and this route must not edit them.
    expect(mockMutateAsync).toHaveBeenCalledWith({
      algorithm: 'tunable_cc',
      n_particles: 20000,
    })
    expect(mockPush).toHaveBeenCalledWith('/projects/p1/simulations/sim-42')
  })
})
