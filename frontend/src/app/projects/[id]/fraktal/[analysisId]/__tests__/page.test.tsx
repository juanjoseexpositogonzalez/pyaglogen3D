/**
 * The FRAKTAL analysis result page, migrated onto the design-system kit
 * (issue #176, slice 2 of 3).
 *
 * Asserted through what a user can perceive — the heading level, the role the
 * failure carries, the href of the way back, which call the buttons make —
 * rather than through which components were imported.
 *
 * The results view is a neighbour with its own file: it is stubbed here so a
 * failure in this file is about the page and never about the readings.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProject = vi.fn()
const mockUseFraktalAnalysis = vi.fn()
const mockDeleteMutate = vi.fn()
const mockRerunMutate = vi.fn()
const mockRefetch = vi.fn()
const mockPush = vi.fn()
const mockResultsProps: Array<Record<string, unknown>> = []

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

vi.mock('@/hooks/useFraktalAnalyses', () => ({
  useFraktalAnalysis: () => mockUseFraktalAnalysis(),
  useDeleteFraktalAnalysis: () => ({ mutateAsync: mockDeleteMutate, isPending: false }),
  useRerunFraktalAnalysis: () => ({ mutateAsync: mockRerunMutate, isPending: false }),
}))

vi.mock('@/components/fraktal/FraktalResultsView', () => ({
  FraktalResultsView: (props: Record<string, unknown>) => {
    mockResultsProps.push(props)
    return React.createElement('div', { 'data-testid': 'fraktal-results' })
  },
}))

import FraktalAnalysisDetailPage from '../page'

const project = () => ({ id: 'p1', name: 'Soot aggregates' })

const analysis = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  project: 'p1',
  status: 'completed',
  model: 'granulated_2012',
  results: null,
  ...overrides,
})

const renderPage = () =>
  render(<FraktalAnalysisDetailPage params={{ id: 'p1', analysisId: 'a1' }} />)

beforeEach(() => {
  vi.clearAllMocks()
  mockResultsProps.length = 0
  mockUseProject.mockReturnValue({ data: project() })
  mockUseFraktalAnalysis.mockReturnValue({
    data: analysis(),
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })
  mockDeleteMutate.mockResolvedValue(undefined)
  mockRerunMutate.mockResolvedValue(undefined)
})

describe('FRAKTAL analysis result page', () => {
  it('says what it is doing while the record is in flight', () => {
    mockUseFraktalAnalysis.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    })

    renderPage()

    expect(screen.getByText('Loading analysis...')).toBeTruthy()
  })

  it('leaves the app frame to the shell', () => {
    const { container } = renderPage()

    // The shell renders the only <main>; a page that paints its own would
    // nest a second landmark inside it.
    expect(container.querySelector('main')).toBeNull()
  })

  it('names the page once, with the model that produced the numbers', () => {
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('FRAKTAL Analysis')
    expect(screen.getByText('Granulated 2012 Model')).toBeTruthy()
    expect(screen.getByText('Back to Soot aggregates')).toBeTruthy()
  })

  it('states a failed load as an alert with a way back', () => {
    mockUseFraktalAnalysis.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('404'),
      refetch: mockRefetch,
    })

    renderPage()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Failed to load analysis')
    expect(alert.textContent).toContain('It may not exist or the backend is unavailable.')
    expect(screen.getByRole('link', { name: 'Back to Project' }).getAttribute('href')).toBe(
      '/projects/p1'
    )
  })

  it('re-runs the analysis and asks for the record again', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    await waitFor(() => {
      expect(mockRerunMutate).toHaveBeenCalledWith('a1')
    })
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('deletes only after confirmation, then returns to the project', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByText('Delete?')).toBeTruthy()
    expect(mockDeleteMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(mockDeleteMutate).toHaveBeenCalledWith('a1')
    })
    expect(mockPush).toHaveBeenCalledWith('/projects/p1')
  })

  it('offers no re-run for a run that cannot be re-run', () => {
    mockUseFraktalAnalysis.mockReturnValue({
      data: analysis({ status: 'running' }),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    })

    renderPage()

    expect(screen.queryByRole('button', { name: /re-run/i })).toBeNull()
  })

  it('hands the record and the project to the results view', () => {
    renderPage()

    expect(screen.getByTestId('fraktal-results')).toBeTruthy()
    expect(mockResultsProps).toHaveLength(1)
    expect((mockResultsProps[0].analysis as { id: string }).id).toBe('a1')
    expect(mockResultsProps[0].projectId).toBe('p1')
  })
})
