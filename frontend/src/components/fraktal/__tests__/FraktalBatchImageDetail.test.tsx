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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { FraktalBatchImageDetail as ImageDetailType } from '@/lib/api'

// Hoist mocks so vi.mock factories can reference them
const { mockPush, mockGetBatchImage, mockGetBatchImagePngUrl, mockReanalyzeBatchImage, mockFetchBatchImagePng } = vi.hoisted(
  () => ({
    mockPush: vi.fn(),
    mockGetBatchImage: vi.fn(),
    mockGetBatchImagePngUrl: vi.fn(),
    mockReanalyzeBatchImage: vi.fn(),
    mockFetchBatchImagePng: vi.fn(),
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
      reanalyzeBatchImage: mockReanalyzeBatchImage,
      fetchBatchImagePng: mockFetchBatchImagePng,
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
    pixels_per_100nm: 500.0,
    autocalibrate_source: null,
    prev_index: 1,
    next_index: 3,
    sim_target_df: null,
    sim_box_counting_df: null,
    sorensen_note: '',
    has_scientific_png: true,
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
    // Default: fetchBatchImagePng succeeds with a fake PNG blob
    mockFetchBatchImagePng.mockResolvedValue(
      new Blob(['fake-png'], { type: 'image/png' })
    )
    // Stub URL.createObjectURL / revokeObjectURL (jsdom doesn't implement them)
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/default-blob')
    globalThis.URL.revokeObjectURL = vi.fn()
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
    it('renders the PNG image via authenticated blob URL', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()
      const img = await screen.findByRole('img')
      // Image src should be a blob URL (from fetchBatchImagePng + createObjectURL),
      // NOT a raw HTTP URL to the PNG endpoint
      await waitFor(() => {
        expect(img.getAttribute('src')).toMatch(/^blob:/)
      })
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

  // --- T6.5: Re-analyze button wiring ---
  describe('re-analyze button (T6.5)', () => {
    it('renders an enabled re-analyze button', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()

      const btn = await screen.findByRole('button', { name: /re-analyze/i })
      expect(btn).toBeTruthy()
      expect(btn.hasAttribute('disabled')).toBe(false)
    })

    it('calls reanalyzeBatchImage and navigates to the new analysis on click', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      mockReanalyzeBatchImage.mockResolvedValue({
        analysis_id: 'new-analysis-999',
      })
      renderComponent()

      const btn = await screen.findByRole('button', { name: /re-analyze/i })
      fireEvent.click(btn)

      await waitFor(() => {
        expect(mockReanalyzeBatchImage).toHaveBeenCalledWith(
          PROJECT_ID,
          BATCH_ID,
          2 // index
        )
      })

      // Should navigate to the new analysis detail page
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/fraktal/new-analysis-999`
        )
      })
    })
  })

  // --- T6.6: Download PNG ---
  describe('download PNG (T6.6)', () => {
    it('renders a Download PNG link pointing to the PNG endpoint', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      renderComponent()

      const link = await screen.findByRole('link', { name: /download png/i })
      expect(link).toBeTruthy()
      expect(link.getAttribute('href')).toContain('/images/2/png/')
    })
  })

  // --- C1 HOTFIX: Diagnostic metadata shown alongside error ---
  describe('C1: diagnostic metadata on error', () => {
    it('renders error banner AND diagnostic card when data.error is truthy', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({
          error: 'Bisection method failed to converge',
          fractal_dimension: null,
          prefactor: null,
          r_squared: null,
          n_particles_counted: null,
          dpo_used: 25.0,
          azimuth: 60,
          elevation: 30,
          pixels_per_100nm: 500.0,
          autocalibrate_source: 'image_0',
        })
      )
      renderComponent()

      // Error banner visible
      expect(
        await screen.findByText(/Bisection method failed to converge/)
      ).toBeTruthy()
      // Diagnostic card also visible
      expect(screen.getByText('Diagnostic Info')).toBeTruthy()
      expect(screen.getByText('25.0')).toBeTruthy() // dpo_used
      expect(screen.getByText('60.0')).toBeTruthy() // azimuth
      expect(screen.getByText('30.0')).toBeTruthy() // elevation
      expect(screen.getByText('500.0')).toBeTruthy() // pixels_per_100nm
      expect(screen.getByText('image_0')).toBeTruthy() // autocalibrate_source
    })

    it('does NOT render diagnostic card when data is successful (no error)', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({
          error: null,
          pixels_per_100nm: 500.0,
          autocalibrate_source: null,
        })
      )
      renderComponent()

      // Wait for success content to load
      expect(await screen.findByText('1.720')).toBeTruthy()
      // Metrics card is shown, diagnostic card is NOT
      expect(screen.getByText('Fractal Metrics')).toBeTruthy()
      expect(screen.queryByText('Diagnostic Info')).toBeNull()
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

  // --- T5.5: analysis_input_variant badge ---
  describe('analysis_input_variant badge (T5.5)', () => {
    it('shows "Analysis input: Presentation" badge when variant is presentation', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ analysis_input_variant: 'presentation' })
      )
      renderComponent()

      expect(
        await screen.findByText(/Analysis input: Presentation/i)
      ).toBeTruthy()
    })

    it('shows "Analysis input: Scientific (binary)" badge when variant is scientific', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ analysis_input_variant: 'scientific' })
      )
      renderComponent()

      expect(
        await screen.findByText(/Analysis input: Scientific \(binary\)/i)
      ).toBeTruthy()
    })
  })

  // --- T5.6: batch_origin indicator ---
  describe('batch_origin indicator (T5.6)', () => {
    it('shows "Origin: From Simulation" when batch_origin is simulation', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ batch_origin: 'simulation' })
      )
      renderComponent()

      expect(
        await screen.findByText(/Origin: From Simulation/i)
      ).toBeTruthy()
    })

    it('shows "Origin: External upload" when batch_origin is external', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ batch_origin: 'external' })
      )
      renderComponent()

      expect(
        await screen.findByText(/Origin: External upload/i)
      ).toBeTruthy()
    })

    it('does not show origin badge when batch_origin is undefined', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ batch_origin: undefined })
      )
      renderComponent()

      // Wait for data to load
      await screen.findByText('1.720')
      expect(screen.queryByText(/Origin:/i)).toBeNull()
    })
  })

  // --- T6.3: Variant toggle UI ---
  describe('variant toggle (T6.3)', () => {
    it('renders Presentation and Scientific buttons', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ has_scientific_png: true })
      )
      renderComponent()

      await screen.findByText('1.720')
      expect(screen.getByRole('button', { name: /presentation/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /scientific/i })).toBeTruthy()
    })

    it('defaults to Presentation variant selected', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ has_scientific_png: true })
      )
      renderComponent()

      await screen.findByText('1.720')
      const presBtn = screen.getByRole('button', { name: /presentation/i })
      // Active button should have data-active or aria-pressed attribute
      expect(
        presBtn.getAttribute('aria-pressed') === 'true' ||
        presBtn.getAttribute('data-active') === 'true'
      ).toBe(true)
    })

    it('disables Scientific button when has_scientific_png is false', async () => {
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ has_scientific_png: false })
      )
      renderComponent()

      await screen.findByText('1.720')
      const sciBtn = screen.getByRole('button', { name: /scientific/i })
      expect(sciBtn.hasAttribute('disabled') || sciBtn.getAttribute('aria-disabled') === 'true').toBe(true)
    })
  })

  // --- T6.4: Variant toggle refetch behavior ---
  describe('variant toggle refetch (T6.4)', () => {
    const PRES_BLOB_URL = 'blob:http://localhost/pres-blob'
    const SCI_BLOB_URL = 'blob:http://localhost/sci-blob'

    beforeEach(() => {
      let callCount = 0
      ;(globalThis.URL.createObjectURL as ReturnType<typeof vi.fn>)
        .mockImplementation(() => {
          callCount++
          return callCount === 1 ? PRES_BLOB_URL : SCI_BLOB_URL
        })
    })

    it('fetches scientific variant when Scientific button is clicked', async () => {
      const presBlob = new Blob(['pres-png'], { type: 'image/png' })
      const sciBlob = new Blob(['sci-png'], { type: 'image/png' })
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ has_scientific_png: true })
      )
      mockFetchBatchImagePng
        .mockResolvedValueOnce(presBlob) // initial fetch
        .mockResolvedValueOnce(sciBlob) // scientific fetch

      renderComponent()
      await screen.findByText('1.720')

      // Wait for initial blob to load
      await waitFor(() => {
        expect(mockFetchBatchImagePng).toHaveBeenCalledWith(
          PROJECT_ID, BATCH_ID, 2, 'presentation'
        )
      })

      // Click scientific
      const sciBtn = screen.getByRole('button', { name: /scientific/i })
      fireEvent.click(sciBtn)

      await waitFor(() => {
        expect(mockFetchBatchImagePng).toHaveBeenCalledWith(
          PROJECT_ID, BATCH_ID, 2, 'scientific'
        )
      })
    })

    it('revokes old blob URL when variant changes', async () => {
      const mockRevoke = globalThis.URL.revokeObjectURL as ReturnType<typeof vi.fn>
      const presBlob = new Blob(['pres'], { type: 'image/png' })
      const sciBlob = new Blob(['sci'], { type: 'image/png' })
      mockGetBatchImage.mockResolvedValue(
        makeImageDetail({ has_scientific_png: true })
      )
      mockFetchBatchImagePng
        .mockResolvedValueOnce(presBlob)
        .mockResolvedValueOnce(sciBlob)

      renderComponent()

      // Wait for initial blob to be created
      await waitFor(() => {
        expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1)
      })

      // Click scientific — should revoke old URL
      const sciBtn = screen.getByRole('button', { name: /scientific/i })
      fireEvent.click(sciBtn)

      await waitFor(() => {
        expect(mockRevoke).toHaveBeenCalledWith(PRES_BLOB_URL)
      })
    })
  })

  // --- T6.5: Comprehensive variant toggle tests ---
  describe('comprehensive variant toggle (T6.5)', () => {
    const PRES_BLOB_URL = 'blob:http://localhost/pres-blob-t65'
    const SCI_BLOB_URL = 'blob:http://localhost/sci-blob-t65'
    const PRES2_BLOB_URL = 'blob:http://localhost/pres2-blob-t65'

    beforeEach(() => {
      let callCount = 0
      ;(globalThis.URL.createObjectURL as ReturnType<typeof vi.fn>)
        .mockImplementation(() => {
          callCount++
          if (callCount === 1) return PRES_BLOB_URL
          if (callCount === 2) return SCI_BLOB_URL
          return PRES2_BLOB_URL
        })
    })

    it('toggle from presentation to scientific calls fetchBatchImagePng with scientific', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail({ has_scientific_png: true }))
      mockFetchBatchImagePng
        .mockResolvedValueOnce(new Blob(['pres'], { type: 'image/png' }))
        .mockResolvedValueOnce(new Blob(['sci'], { type: 'image/png' }))

      renderComponent()
      await screen.findByText('1.720')
      await waitFor(() => expect(mockFetchBatchImagePng).toHaveBeenCalledTimes(1))

      fireEvent.click(screen.getByRole('button', { name: /scientific/i }))

      await waitFor(() => {
        expect(mockFetchBatchImagePng).toHaveBeenCalledWith(
          PROJECT_ID, BATCH_ID, 2, 'scientific'
        )
      })
    })

    it('toggle back to presentation calls fetchBatchImagePng with presentation', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail({ has_scientific_png: true }))
      mockFetchBatchImagePng
        .mockResolvedValueOnce(new Blob(['pres'], { type: 'image/png' }))
        .mockResolvedValueOnce(new Blob(['sci'], { type: 'image/png' }))
        .mockResolvedValueOnce(new Blob(['pres2'], { type: 'image/png' }))

      renderComponent()
      await screen.findByText('1.720')
      await waitFor(() => expect(mockFetchBatchImagePng).toHaveBeenCalledTimes(1))

      // Click scientific
      fireEvent.click(screen.getByRole('button', { name: /scientific/i }))
      await waitFor(() => expect(mockFetchBatchImagePng).toHaveBeenCalledTimes(2))

      // Click presentation again
      fireEvent.click(screen.getByRole('button', { name: /presentation/i }))

      await waitFor(() => {
        expect(mockFetchBatchImagePng).toHaveBeenCalledTimes(3)
        expect(mockFetchBatchImagePng).toHaveBeenLastCalledWith(
          PROJECT_ID, BATCH_ID, 2, 'presentation'
        )
      })
    })

    it('scientific button has disabled attribute when has_scientific_png=false', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail({ has_scientific_png: false }))
      mockFetchBatchImagePng.mockResolvedValue(new Blob(['pres'], { type: 'image/png' }))

      renderComponent()
      await screen.findByText('1.720')

      const sciBtn = screen.getByRole('button', { name: /scientific/i })
      expect(sciBtn.hasAttribute('disabled')).toBe(true)
    })

    it('clicking disabled scientific button does NOT trigger fetch', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail({ has_scientific_png: false }))
      mockFetchBatchImagePng.mockResolvedValue(new Blob(['pres'], { type: 'image/png' }))

      renderComponent()
      await screen.findByText('1.720')
      await waitFor(() => expect(mockFetchBatchImagePng).toHaveBeenCalledTimes(1))

      // Try clicking disabled scientific button
      const sciBtn = screen.getByRole('button', { name: /scientific/i })
      fireEvent.click(sciBtn)

      // Should NOT have been called again — still only 1 call (the initial presentation)
      expect(mockFetchBatchImagePng).toHaveBeenCalledTimes(1)
    })

    it('blob URL is revoked when variant changes (revokeObjectURL called with old URL)', async () => {
      const mockRevoke = globalThis.URL.revokeObjectURL as ReturnType<typeof vi.fn>
      mockGetBatchImage.mockResolvedValue(makeImageDetail({ has_scientific_png: true }))
      mockFetchBatchImagePng
        .mockResolvedValueOnce(new Blob(['pres'], { type: 'image/png' }))
        .mockResolvedValueOnce(new Blob(['sci'], { type: 'image/png' }))

      renderComponent()
      await waitFor(() => expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1))

      fireEvent.click(screen.getByRole('button', { name: /scientific/i }))

      await waitFor(() => {
        expect(mockRevoke).toHaveBeenCalledWith(PRES_BLOB_URL)
      })
    })
  })

  // --- HOTFIX: PNG auth via blob URL (fetch + createObjectURL) ---
  describe('PNG auth via blob URL', () => {
    const FAKE_BLOB_URL = 'blob:http://localhost/fake-blob-123'
    let mockCreateObjectURL: ReturnType<typeof vi.fn>
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockCreateObjectURL = vi.fn().mockReturnValue(FAKE_BLOB_URL)
      mockRevokeObjectURL = vi.fn()
      // Override the stubs from outer beforeEach with specific spies
      globalThis.URL.createObjectURL =
        mockCreateObjectURL as unknown as typeof URL.createObjectURL
      globalThis.URL.revokeObjectURL =
        mockRevokeObjectURL as unknown as typeof URL.revokeObjectURL
    })

    it('calls fetchBatchImagePng to authenticate the PNG request', async () => {
      const fakeBlob = new Blob(['png-data'], { type: 'image/png' })
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      mockFetchBatchImagePng.mockResolvedValue(fakeBlob)

      renderComponent()
      await screen.findByText('1.720') // wait for data to load

      expect(mockFetchBatchImagePng).toHaveBeenCalledWith(
        PROJECT_ID,
        BATCH_ID,
        2,
        'presentation'
      )
    })

    it('sets <img> src to a blob: URL on successful fetch', async () => {
      const fakeBlob = new Blob(['png-data'], { type: 'image/png' })
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      mockFetchBatchImagePng.mockResolvedValue(fakeBlob)

      renderComponent()

      const img = await screen.findByRole('img')
      await waitFor(() => {
        expect(img.getAttribute('src')).toBe(FAKE_BLOB_URL)
      })
      expect(mockCreateObjectURL).toHaveBeenCalledWith(fakeBlob)
    })

    it('shows error banner when fetchBatchImagePng returns 401', async () => {
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      mockFetchBatchImagePng.mockRejectedValue(
        new Error('Unauthorized')
      )

      renderComponent()

      expect(
        await screen.findByText(/failed to load image/i)
      ).toBeTruthy()
    })

    it('calls URL.revokeObjectURL on unmount to prevent memory leak', async () => {
      const fakeBlob = new Blob(['png-data'], { type: 'image/png' })
      mockGetBatchImage.mockResolvedValue(makeImageDetail())
      mockFetchBatchImagePng.mockResolvedValue(fakeBlob)

      const { unmount } = renderComponent()

      // Wait for blob URL to be set
      await waitFor(() => {
        expect(mockCreateObjectURL).toHaveBeenCalled()
      })

      unmount()

      expect(mockRevokeObjectURL).toHaveBeenCalledWith(FAKE_BLOB_URL)
    })
  })
})
