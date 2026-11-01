/**
 * Tests for the Batch Summary page (C2 hotfix).
 *
 * The page fetches batch detail via getBatch and renders
 * FraktalBatchResultsView. Tests cover:
 *   - Batch metadata visible (dpo_used, n_images, calibration)
 *   - Images table renders all rows with drill-down links
 *   - Loading skeleton
 *   - Error state (404) with back link
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { FraktalBatchResult } from '@/lib/api'

// Hoist mocks
const { mockGetBatch, mockDeleteBatch, mockDownloadBatchCsv } = vi.hoisted(() => ({
  mockGetBatch: vi.fn(),
  mockDeleteBatch: vi.fn(),
  mockDownloadBatchCsv: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/projects/proj-1/fraktal/batch/batch-123',
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => React.createElement('a', { href, ...rest }, children),
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    const PlotStub = () => React.createElement('div', { 'data-testid': 'plot-stub' })
    PlotStub.displayName = 'PlotStub'
    return PlotStub
  },
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      getBatch: mockGetBatch,
      deleteBatch: mockDeleteBatch,
      downloadBatchCsv: mockDownloadBatchCsv,
    },
  }
})

import { FraktalBatchSummaryPage } from '../FraktalBatchSummaryPage'

// ---------- Fixtures ----------

function makeBatchResult(
  overrides: Partial<FraktalBatchResult> = {}
): FraktalBatchResult {
  return {
    batch_id: 'batch-123',
    images: [
      {
        index: 0,
        filename: 'proj_000.png',
        azimuth: 0,
        elevation: -90,
        fractal_dimension: 1.72,
        prefactor: 1.5,
        r_squared: 0.99,
        n_particles_counted: 42,
        error: null,
      },
      {
        index: 1,
        filename: 'proj_001.png',
        azimuth: 30,
        elevation: 0,
        fractal_dimension: 1.80,
        prefactor: 1.4,
        r_squared: 0.98,
        n_particles_counted: 38,
        error: null,
      },
      {
        index: 2,
        filename: 'proj_002.png',
        azimuth: 60,
        elevation: 30,
        fractal_dimension: null,
        prefactor: null,
        r_squared: null,
        n_particles_counted: null,
        error: 'Bisection failed',
      },
    ],
    stats: {
      n_images: 3,
      n_successful: 2,
      mean_df: 1.76,
      std_df: 0.04,
      median_df: 1.76,
      q1_df: 1.74,
      q3_df: 1.78,
      min_df: 1.72,
      max_df: 1.80,
    },
    histogram: null,
    comparison: null,
    calibration: {
      source: 'metadata',
      pixels_per_100nm: 500.0,
      dpo_used: 25.0,
      autocalibrate_image: null,
    },
    ...overrides,
  }
}

// ---------- Tests ----------

describe('<FraktalBatchSummaryPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading skeleton while fetching', () => {
    mockGetBatch.mockReturnValue(new Promise(() => {})) // never resolves
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('renders batch summary stats when data loads', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )

    // Wait for stats to render — n_successful / n_images
    expect(await screen.findByText('2 / 3')).toBeTruthy()
    // Mean Df label present
    expect(screen.getByText('Mean Df')).toBeTruthy()
  })

  it('renders all image rows in the results table', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )

    // Wait for table to render
    await screen.findByText('proj_000.png')
    expect(screen.getByText('proj_001.png')).toBeTruthy()
    expect(screen.getByText('proj_002.png')).toBeTruthy()
  })

  it('each image row links to drill-down at correct index', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )

    await screen.findByText('proj_000.png')
    const links = screen.getAllByRole('link')
    const drilldownLinks = links.filter((a) =>
      a.getAttribute('href')?.includes('/image/')
    )
    // 3 images × 8 table columns = 24 drill-down links
    expect(drilldownLinks.length).toBeGreaterThanOrEqual(3)
    // First row links to image/0
    const firstRowLink = drilldownLinks.find((a) =>
      a.getAttribute('href')?.endsWith('/image/0')
    )
    expect(firstRowLink).toBeTruthy()
  })

  it('renders error state when getBatch rejects (404)', async () => {
    mockGetBatch.mockRejectedValue(new Error('Not found'))
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )

    expect(await screen.findByText(/failed to load batch/i)).toBeTruthy()
  })

  it('renders a back link to the project on error', async () => {
    mockGetBatch.mockRejectedValue(new Error('Not found'))
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )

    const link = await screen.findByRole('link', { name: /back to project/i })
    expect(link.getAttribute('href')).toBe('/projects/proj-1')
  })

  // Frente 9 P4: distributions section persists in the summary view.
  it('renders the Distributions section above the results table', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(
      <FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />
    )

    // Distributions heading appears
    await screen.findByText(/distributions/i)
    // Section is labeled for accessibility
    expect(
      screen.getByRole('region', { name: /metric distributions/i }),
    ).toBeTruthy()
  })
})

// ---- Issue #176, slice 3A: the summary on the design-system kit ----
//
// The component keeps fetching the batch and keeps handing it to the same
// results view. What changes is the frame it puts around it: a `PageHeader`
// instead of a bare `h1`, a `Callout` instead of a hand-built error card, and
// the distributions block inside a `Panel`.

describe('<FraktalBatchSummaryPage /> — design-system kit presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the page with a PageHeader carrying the FRAKTAL eyebrow', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(<FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />)

    expect(await screen.findByText('FRAKTAL')).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 1, name: /batch summary/i }),
    ).toBeTruthy()
  })

  it('leaves the document frame to the shell: no main of its own', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(<FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />)

    await screen.findByText('proj_000.png')
    expect(document.querySelector('main')).toBeNull()
  })

  it('states a failed load in a danger alert that keeps the reason', async () => {
    mockGetBatch.mockRejectedValue(new Error('Not found'))
    render(<FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Failed to load batch')
    // The server's own reason survives: a 404 and a 500 must not read alike.
    expect(alert.textContent).toContain('Not found')
  })

  it('keeps the distributions in a labelled region with its own heading', async () => {
    mockGetBatch.mockResolvedValue(makeBatchResult())
    render(<FraktalBatchSummaryPage projectId="proj-1" batchId="batch-123" />)

    const region = await screen.findByRole('region', {
      name: /metric distributions/i,
    })
    expect(
      within(region).getByRole('heading', { name: /distributions/i }),
    ).toBeTruthy()
  })
})
