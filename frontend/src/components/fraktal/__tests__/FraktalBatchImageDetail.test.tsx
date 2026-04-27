/**
 * Unit tests for <FraktalBatchImageDetail /> (T5.3 + T5.4 + T5.5, change:
 * fraktal-drilldown-and-csv).
 *
 * Tests cover:
 *   - Image rendering via PNG URL
 *   - Metric display (Df, kf, R², n_particles, dpo_used, calibration source)
 *   - Error state display (when image has error)
 *   - Prev/Next navigation (links, disabled states at boundaries)
 *   - Keyboard shortcuts (← →) for prev/next
 *   - Loading skeleton during fetch
 *   - Error banner on fetch failure (404, 403)
 *   - Back link to batch results
 *   - Re-analyze button placeholder
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { FraktalBatchImageDetail as ImageDetailType } from '@/lib/api'

// Hoist mocks so vi.mock factories can reference them
const { mockPush, mockGetBatchImage, mockGetBatchImagePngUrl } = vi.hoisted(
  () => ({
    mockPush: vi.fn(),
    mockGetBatchImage: vi.fn(),
    mockGetBatchImagePngUrl: vi.fn(),
  })
)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/projects/proj-1/fraktal/batch/batch-abc/image/2',
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
  }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      getBatchImage: mockGetBatchImage,
      getBatchImagePngUrl: mockGetBatchImagePngUrl,
    },
  }
})

import { FraktalBatchImageDetail } from '../FraktalBatchImageDetail'

// ---------- Fixtures ----------

const PROJECT_ID = 'proj-1'
const BATCH_ID = 'batch-abc'

function makeImageDetail(
  overrides: Partial<ImageDetailType> = {}
): ImageDetailType {
  return {
    batch_id: BATCH_ID,
    index: 2,
    filename: 'proj_002.png',
    azimuth: 60,
    elevation: 30,
    fractal_dimension: 1.72,
    prefactor: 1.31,
    r_squared: 0.995,
    n_particles_counted: 48,
    error: null,
    dpo_used: 25.0,
    prev_index: 1,
    next_index: 3,
    sim_target_df: null,
    sim_box_counting_df: null,
    sorensen_note: '',
    ...overrides,
  }
}

// ---------- Helper ----------

function renderComponent(index = 2) {
  return render(
    <FraktalBatchImageDetail
      projectId={PROJECT_ID}
      batchId={BATCH_ID}
      index={index}
    />
  )
}

// ---------- Tests ----------

describe('<FraktalBatchImageDetail />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBatchImagePngUrl.mockReturnValue(
      `http://localhost:8000/api/v1/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/images/2/png/`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- T5.5: Loading state ---
  describe('loading state', () => {
    it('shows a loading skeleton while fetching', () => {
      // Never resolves — simulates loading
      mockGetBatchImage.mockReturnValue(new Promise(() => {}))
      renderComponent()
      expect(screen.getByText(/loading/i)).toBeTruthy()
    })
  })

  // --- T5.5: Error state ---
  describe('error state', () => {
    it('shows an error banner when fetch rejects with 404', async () => {
      mockGetBatchImage.mockRejectedValue(
        new Error('Not found')
      )
      renderComponent()
      expect(
        await screen.findByText(/failed to load/i)
      ).toBeTruthy()
    })

    it('shows a back link to batch results on error', async () => {
      mockGetBatchImage.mockRejectedValue(new Error('Forbidden'))
      renderComponent()
      const backLink = await screen.findByRole('link', { name: /back to batch/i })
      expect(backLink).toBeTruthy()
      expect(backLink.getAttribute('href')).toContain(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}`
      )
    })
  })

  // --- T5.3: Image + metrics rendering ---
  describe('image and metrics', () => {
    it('renders the PNG image via getBatchImagePngUrl', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      const img = await screen.findByRole('img')
      expect(img.getAttribute('src')).toContain('/images/2/png/')
    })

    it('displays fractal dimension (Df) value', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      expect(await screen.findByText('1.720')).toBeTruthy()
    })

    it('displays prefactor (kf) value', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      expect(await screen.findByText('1.310')).toBeTruthy()
    })

    it('displays R² value', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      expect(await screen.findByText('0.995')).toBeTruthy()
    })

    it('displays n_particles_counted', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      expect(await screen.findByText('48')).toBeTruthy()
    })

    it('displays dpo_used', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      expect(await screen.findByText('25.0')).toBeTruthy()
    })

    it('shows error text when image has an error', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ error: 'Threshold failed: no particles detected', fractal_dimension: null })
      )
      renderComponent()
      expect(
        await screen.findByText(/Threshold failed: no particles detected/)
      ).toBeTruthy()
    })
  })

  // --- T5.4: Prev/Next navigation ---
  describe('prev/next navigation', () => {
    it('renders enabled prev and next links when both are available', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ prev_index: 1, next_index: 3 })
      )
      renderComponent()

      const prevLink = await screen.findByRole('link', { name: /previous/i })
      const nextLink = await screen.findByRole('link', { name: /next/i })

      expect(prevLink.getAttribute('href')).toContain('/image/1')
      expect(nextLink.getAttribute('href')).toContain('/image/3')
    })

    it('disables prev button when prev_index is null (first image)', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ index: 0, prev_index: null, next_index: 1 })
      )
      mockGetBatchImagePngUrl.mockReturnValue('http://localhost/png/0')
      renderComponent(0)

      // Wait for content to load
      await screen.findByRole('img')
      // Prev should be a disabled button, not a link
      const prevBtn = screen.getByRole('button', { name: /previous/i })
      expect(prevBtn).toBeTruthy()
      expect(prevBtn.hasAttribute('disabled') || prevBtn.getAttribute('aria-disabled') === 'true').toBe(true)
    })

    it('disables next button when next_index is null (last image)', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ index: 4, prev_index: 3, next_index: null })
      )
      mockGetBatchImagePngUrl.mockReturnValue('http://localhost/png/4')
      renderComponent(4)

      await screen.findByRole('img')
      const nextBtn = screen.getByRole('button', { name: /next/i })
      expect(nextBtn).toBeTruthy()
      expect(nextBtn.hasAttribute('disabled') || nextBtn.getAttribute('aria-disabled') === 'true').toBe(true)
    })

    it('navigates to previous image on ArrowLeft keydown', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ prev_index: 1, next_index: 3 })
      )
      renderComponent()

      await screen.findByRole('img')
      fireEvent.keyDown(document, { key: 'ArrowLeft' })
      expect(mockPush).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}/image/1`
      )
    })

    it('navigates to next image on ArrowRight keydown', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ prev_index: 1, next_index: 3 })
      )
      renderComponent()

      await screen.findByRole('img')
      fireEvent.keyDown(document, { key: 'ArrowRight' })
      expect(mockPush).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}/image/3`
      )
    })

    it('does NOT navigate on ArrowLeft when prev_index is null', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ prev_index: null, next_index: 1 })
      )
      renderComponent(0)

      await screen.findByRole('img')
      fireEvent.keyDown(document, { key: 'ArrowLeft' })
      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  // --- T5.3: Re-analyze button placeholder ---
  describe('re-analyze button', () => {
    it('renders a re-analyze button (placeholder for Phase 6 wiring)', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()

      const btn = await screen.findByRole('button', { name: /re-analyze/i })
      expect(btn).toBeTruthy()
    })
  })

  // --- T5.3: Back link ---
  describe('back link', () => {
    it('renders a back link to the batch results page', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()

      const backLink = await screen.findByRole('link', { name: /back to batch/i })
      expect(backLink.getAttribute('href')).toBe(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}`
      )
    })
  })
})
