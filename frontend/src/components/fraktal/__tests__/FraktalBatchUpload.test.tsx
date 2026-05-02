/**
 * Unit tests for <FraktalBatchUpload /> (T4.7, change: fraktal-batch-analysis).
 *
 * Covers the behaviors in specs/fraktal-batch-contract.md that live in the
 * client:
 *   - ZIP > 100 MB rejected before submit (R?: upload size guard)
 *   - metadata.json auto-detection shows the "Auto-calibrated" badge (R1)
 *   - ZIPs without metadata fall back to the manual pixels/100nm input (R2)
 *   - submit button gating (R5)
 *
 * The network layer (`fraktalApi.analyzeBatch`) is mocked so none of these
 * tests hit fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import JSZip from 'jszip'

import { FraktalBatchUpload } from '../FraktalBatchUpload'

// Hoist the mock fn so test cases can inspect calls
const { mockAnalyzeBatch } = vi.hoisted(() => ({
  mockAnalyzeBatch: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      analyzeBatch: mockAnalyzeBatch,
    },
  }
})

// QueryClientProvider wrapper for all renders — FraktalBatchUpload uses
// useQueryClient() for cache invalidation on success.
let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('<FraktalBatchUpload />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it('renders the upload form with ZIP input', () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    expect(screen.getByText(/Batch FRAKTAL Analysis/i)).toBeTruthy()
    expect(screen.getByLabelText(/ZIP file/i)).toBeTruthy()
  })

  it('does not show the manual scale input until a file is selected', () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    // manual pixels/100nm input only appears once a file without metadata
    // is chosen; at render time no file is selected so it's hidden.
    expect(screen.queryByLabelText(/Pixels per 100 nm \(manual\)/i)).toBeNull()
  })

  it('shows auto-calibrated badge when the ZIP carries metadata.json', async () => {
    const zip = new JSZip()
    // Minimal PNG header is fine; backend never sees this file in the test.
    zip.file('proj_000.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    zip.file(
      'metadata.json',
      JSON.stringify({
        mode: 'grid',
        parameters: { pixels_per_100nm: 500.0 },
      })
    )
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'test.zip', { type: 'application/zip' })

    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Auto-calibrated from metadata/i)).toBeTruthy()
    })
    expect(screen.getByText(/500\.0 px\/100nm/)).toBeTruthy()
  })

  it('shows the manual scale input when the ZIP has no metadata.json', async () => {
    const zip = new JSZip()
    zip.file('img.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'nometadata.zip', { type: 'application/zip' })

    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Pixels per 100 nm \(manual\)/i)
      ).toBeTruthy()
    })
  })

  it('disables the submit button when no file is chosen', () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    const btn = screen.getByRole('button', {
      name: /Analyze batch/i,
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('rejects files larger than 100 MB', async () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement

    // Fake a File whose .size reports > 100 MB without allocating 100 MB
    // of memory. File's constructor always produces a real ArrayBuffer of
    // whatever you pass in, so override the size property post-hoc.
    const bigFile = new File([new ArrayBuffer(0)], 'big.zip', {
      type: 'application/zip',
    })
    Object.defineProperty(bigFile, 'size', { value: 101 * 1024 * 1024 })

    fireEvent.change(input, { target: { files: [bigFile] } })

    await waitFor(() => {
      // Alert has role="alert" baked in; the size-guard alert is the only
      // error alert that appears before submission.
      const alerts = screen.getAllByRole('alert')
      const match = alerts.find((el) => /too large/i.test(el.textContent ?? ''))
      expect(match).toBeTruthy()
    })
  })

  // T6.1 — Wire projectId: analyzeBatch must receive projectId so the
  // project-scoped URL (/api/v1/projects/{id}/fraktal/analyze-batch/) is used
  // instead of the legacy global endpoint.
  it('passes projectId to analyzeBatch when provided', async () => {
    const zip = new JSZip()
    zip.file('proj_000.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    zip.file(
      'metadata.json',
      JSON.stringify({
        mode: 'grid',
        parameters: { pixels_per_100nm: 500.0 },
      })
    )
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'test.zip', { type: 'application/zip' })

    // analyzeBatch should resolve so handleSubmit completes cleanly
    mockAnalyzeBatch.mockResolvedValue({
      images: [],
      stats: { n_images: 0, n_successful: 0, mean_df: null, std_df: null, median_df: null, q1_df: null, q3_df: null, min_df: null, max_df: null },
      histogram: null,
      comparison: null,
      calibration: { source: 'metadata', pixels_per_100nm: 500, dpo_used: 25, autocalibrate_image: null },
    })

    render(<FraktalBatchUpload projectId="proj-42" onSuccess={vi.fn()} />, { wrapper })
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    // Wait for auto-calibration detection and submit enable
    await waitFor(() => {
      expect(screen.getByText(/Auto-calibrated from metadata/i)).toBeTruthy()
    })

    const btn = screen.getByRole('button', { name: /Analyze batch/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockAnalyzeBatch).toHaveBeenCalledTimes(1)
    })

    // Verify the second argument (options) contains projectId
    const [, options] = mockAnalyzeBatch.mock.calls[0]
    expect(options).toBeDefined()
    expect(options.projectId).toBe('proj-42')
  })

  it('uses legacy endpoint (no projectId) when projectId prop is omitted', async () => {
    const zip = new JSZip()
    zip.file('proj_000.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    zip.file(
      'metadata.json',
      JSON.stringify({
        mode: 'grid',
        parameters: { pixels_per_100nm: 500.0 },
      })
    )
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'test.zip', { type: 'application/zip' })

    mockAnalyzeBatch.mockResolvedValue({
      images: [],
      stats: { n_images: 0, n_successful: 0, mean_df: null, std_df: null, median_df: null, q1_df: null, q3_df: null, min_df: null, max_df: null },
      histogram: null,
      comparison: null,
      calibration: { source: 'metadata', pixels_per_100nm: 500, dpo_used: 25, autocalibrate_image: null },
    })

    render(<FraktalBatchUpload onSuccess={vi.fn()} />, { wrapper })
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Auto-calibrated from metadata/i)).toBeTruthy()
    })

    const btn = screen.getByRole('button', { name: /Analyze batch/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockAnalyzeBatch).toHaveBeenCalledTimes(1)
    })

    // When no projectId is provided, options.projectId should be undefined
    const [, options] = mockAnalyzeBatch.mock.calls[0]
    expect(options.projectId).toBeUndefined()
  })

  it('invalidates fraktal-batches query on successful upload', async () => {
    const zip = new JSZip()
    zip.file('proj_000.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    zip.file(
      'metadata.json',
      JSON.stringify({
        mode: 'grid',
        parameters: { pixels_per_100nm: 500.0 },
      })
    )
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'test.zip', { type: 'application/zip' })

    mockAnalyzeBatch.mockResolvedValue({
      images: [],
      stats: { n_images: 0, n_successful: 0, mean_df: null, std_df: null, median_df: null, q1_df: null, q3_df: null, min_df: null, max_df: null },
      histogram: null,
      comparison: null,
      calibration: { source: 'metadata', pixels_per_100nm: 500, dpo_used: 25, autocalibrate_image: null },
    })

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <FraktalBatchUpload projectId="proj-42" onSuccess={vi.fn()} />,
      { wrapper }
    )
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Auto-calibrated from metadata/i)).toBeTruthy()
    })

    const btn = screen.getByRole('button', { name: /Analyze batch/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockAnalyzeBatch).toHaveBeenCalledTimes(1)
    })

    // After successful upload, both query keys should be invalidated
    await waitFor(() => {
      const calls = invalidateSpy.mock.calls
      const invalidatedKeys = calls.map((c) => c[0])
      // Must invalidate fraktal-batches for the project
      const batchInvalidation = invalidatedKeys.find(
        (k: any) =>
          k?.queryKey?.[0] === 'fraktal-batches' &&
          k?.queryKey?.[1] === 'proj-42'
      )
      expect(batchInvalidation).toBeDefined()
      // Must also invalidate the single-image fraktal list
      const fraktalInvalidation = invalidatedKeys.find(
        (k: any) =>
          k?.queryKey?.[0] === 'fraktal' && k?.queryKey?.[1] === 'proj-42'
      )
      expect(fraktalInvalidation).toBeDefined()
    })
  })

  // --- T5.1/T5.2: sim-origin props pre-fill autocalibrate OFF + dpo from sim ---
  describe('sim-origin path (T5.1 + T5.2)', () => {
    it('defaults autocalibrate OFF and pre-fills dpo when origin="simulation"', () => {
      render(
        <FraktalBatchUpload
          onSuccess={vi.fn()}
          origin="simulation"
          simulation={{ id: 'sim-1', parameters: { dpo_nm: 25 } }}
        />,
        { wrapper }
      )

      // Autocalibrate checkbox should be unchecked (OFF)
      const autoCheckbox = screen.getByLabelText(/auto-calibrate dpo/i) as HTMLInputElement
      expect(autoCheckbox.checked).toBe(false)

      // dpo input should be visible and pre-filled with 25
      const dpoInput = screen.getByLabelText(/dpo \(nm\)/i) as HTMLInputElement
      expect(dpoInput.value).toBe('25')
    })

    it('shows sim-origin info banner with literal spec E3.5 text', () => {
      render(
        <FraktalBatchUpload
          onSuccess={vi.fn()}
          origin="simulation"
          simulation={{ id: 'sim-1', parameters: { dpo_nm: 25 } }}
        />,
        { wrapper }
      )

      expect(
        screen.getByText(/Using known dpo = 25 nm from simulation\. Override\?/i)
      ).toBeTruthy()
    })

    it('pre-fills dpo with a different sim value (triangulation)', () => {
      render(
        <FraktalBatchUpload
          onSuccess={vi.fn()}
          origin="simulation"
          simulation={{ id: 'sim-2', parameters: { dpo_nm: 42.5 } }}
        />,
        { wrapper }
      )

      const dpoInput = screen.getByLabelText(/dpo \(nm\)/i) as HTMLInputElement
      expect(dpoInput.value).toBe('42.5')

      expect(
        screen.getByText(/Using known dpo = 42\.5 nm from simulation\. Override\?/i)
      ).toBeTruthy()
    })
  })

  // --- T5.4: origin + sim_dpo_nm wired to API call ---
  describe('API wiring (T5.4)', () => {
    async function renderAndSubmitWithMetadata(
      extraProps: Partial<Parameters<typeof FraktalBatchUpload>[0]> = {}
    ) {
      const zip = new JSZip()
      zip.file('proj_000.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
      zip.file(
        'metadata.json',
        JSON.stringify({
          mode: 'grid',
          parameters: { pixels_per_100nm: 500.0 },
        })
      )
      const blob = await zip.generateAsync({ type: 'blob' })
      const file = new File([blob], 'test.zip', { type: 'application/zip' })

      mockAnalyzeBatch.mockResolvedValue({
        images: [],
        stats: { n_images: 0, n_successful: 0, mean_df: null, std_df: null, median_df: null, q1_df: null, q3_df: null, min_df: null, max_df: null },
        histogram: null,
        comparison: null,
        calibration: { source: 'manual', pixels_per_100nm: 500, dpo_used: 25, autocalibrate_image: null },
      })

      render(
        <FraktalBatchUpload onSuccess={vi.fn()} projectId="proj-42" {...extraProps} />,
        { wrapper }
      )
      const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText(/Auto-calibrated from metadata/i)).toBeTruthy()
      })

      const btn = screen.getByRole('button', { name: /Analyze batch/i })
      fireEvent.click(btn)

      await waitFor(() => {
        expect(mockAnalyzeBatch).toHaveBeenCalledTimes(1)
      })

      return mockAnalyzeBatch.mock.calls[0]
    }

    it('sends origin="simulation" and sim_dpo_nm when origin is simulation', async () => {
      const [reqArg] = await renderAndSubmitWithMetadata({
        origin: 'simulation',
        simulation: { id: 'sim-1', parameters: { dpo_nm: 25 } },
      })
      expect(reqArg.origin).toBe('simulation')
      expect(reqArg.sim_dpo_nm).toBe(25)
    })

    it('sends origin="external" and no sim_dpo_nm for external origin', async () => {
      const [reqArg] = await renderAndSubmitWithMetadata({
        origin: 'external',
      })
      expect(reqArg.origin).toBe('external')
      expect(reqArg.sim_dpo_nm).toBeUndefined()
    })

    it('defaults origin to "external" when prop is omitted', async () => {
      const [reqArg] = await renderAndSubmitWithMetadata()
      expect(reqArg.origin).toBe('external')
      expect(reqArg.sim_dpo_nm).toBeUndefined()
    })
  })

  // --- T5.3: external/default path keeps current behavior ---
  describe('external-origin path (T5.3)', () => {
    it('defaults autocalibrate OFF with no banner when origin="external"', () => {
      render(
        <FraktalBatchUpload onSuccess={vi.fn()} origin="external" />,
        { wrapper }
      )

      // Default behavior: autocalibrate checkbox unchecked (current default is false)
      const autoCheckbox = screen.getByLabelText(/auto-calibrate dpo/i) as HTMLInputElement
      expect(autoCheckbox.checked).toBe(false)

      // No sim-origin banner
      expect(screen.queryByText(/Using known dpo/i)).toBeNull()
    })

    it('defaults to external behavior when origin prop is omitted', () => {
      render(
        <FraktalBatchUpload onSuccess={vi.fn()} />,
        { wrapper }
      )

      // No sim-origin banner
      expect(screen.queryByText(/Using known dpo/i)).toBeNull()
    })
  })
})
