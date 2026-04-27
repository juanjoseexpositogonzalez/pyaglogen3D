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

describe('<FraktalBatchUpload />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the upload form with ZIP input', () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
    expect(screen.getByText(/Batch FRAKTAL Analysis/i)).toBeTruthy()
    expect(screen.getByLabelText(/ZIP file/i)).toBeTruthy()
  })

  it('does not show the manual scale input until a file is selected', () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
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

    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
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

    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
    const input = screen.getByLabelText(/ZIP file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Pixels per 100 nm \(manual\)/i)
      ).toBeTruthy()
    })
  })

  it('disables the submit button when no file is chosen', () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
    const btn = screen.getByRole('button', {
      name: /Analyze batch/i,
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('rejects files larger than 100 MB', async () => {
    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
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

    render(<FraktalBatchUpload projectId="proj-42" onSuccess={vi.fn()} />)
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

    render(<FraktalBatchUpload onSuccess={vi.fn()} />)
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
})
