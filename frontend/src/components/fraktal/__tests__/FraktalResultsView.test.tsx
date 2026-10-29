/**
 * Unit tests for <FraktalResultsView /> CSV download button (T6.4, change:
 * fraktal-drilldown-and-csv).
 *
 * The component has many dependencies (fraktalApi calls, blob URLs, polling).
 * These tests focus specifically on the CSV download behavior added in Phase 6.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Hoist mocks
const { mockDownloadSingleCsv, mockGetOriginalImage, mockGet } = vi.hoisted(
  () => ({
    mockDownloadSingleCsv: vi.fn(),
    mockGetOriginalImage: vi.fn(),
    mockGet: vi.fn(),
  })
)

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      downloadSingleCsv: mockDownloadSingleCsv,
      getOriginalImage: mockGetOriginalImage,
      get: mockGet,
    },
  }
})

import { FraktalResultsView } from '../FraktalResultsView'
import type { FraktalAnalysis } from '@/lib/types'

function makeAnalysis(
  overrides: Partial<FraktalAnalysis> = {}
): FraktalAnalysis {
  return {
    id: 'analysis-123',
    project: 'proj-1',
    created_at: '2026-04-01T12:00:00Z',
    completed_at: '2026-04-01T12:00:05Z',
    status: 'completed',
    model: 'granulated_2012',
    source_type: 'uploaded_image',
    original_filename: 'test.png',
    original_content_type: 'image/png',
    npix: 500,
    escala: 10,
    dpo: 25,
    delta: 1,
    correction_3d: false,
    pixel_min: 0,
    pixel_max: 255,
    npo_limit: 100,
    execution_time_ms: 150,
    engine_version: '1.0.0',
    error_message: null,
    projection_params: null,
    auto_calibrate: false,
    m_exponent: null,
    results: {
      df: 1.72,
      kf: 1.31,
      zf: 0.5,
      rg: 120,
      ap: 45000,
      jf: null,
      volume: 100000,
      surface_area: 80000,
      mass: 0.5,
      npo: 48,
      npo_visual: 50,
      npo_aligned: true,
      npo_ratio: 0.96,
      dpo_estimated: 25,
      best_dpo: null,
      calibration_attempts: [],
    },
    ...overrides,
  } as FraktalAnalysis
}

const PROJECT_ID = 'proj-1'

describe('<FraktalResultsView /> CSV download (T6.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Prevent the original image useEffect from hanging
    mockGetOriginalImage.mockRejectedValue(new Error('not available'))
  })

  it('renders a Download CSV button for a completed analysis', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis()}
        projectId={PROJECT_ID}
      />
    )
    expect(
      screen.getByRole('button', { name: /download csv/i })
    ).toBeTruthy()
  })

  it('calls downloadSingleCsv with correct projectId and analysisId on click', async () => {
    mockDownloadSingleCsv.mockResolvedValue(new Blob(['csv data']))
    const mockCreateObjectURL = vi.fn(() => 'blob:test')
    const mockRevokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = mockCreateObjectURL
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL

    render(
      <FraktalResultsView
        analysis={makeAnalysis()}
        projectId={PROJECT_ID}
      />
    )
    const btn = screen.getByRole('button', { name: /download csv/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockDownloadSingleCsv).toHaveBeenCalledWith(
        PROJECT_ID,
        'analysis-123'
      )
    })
  })

  it('does not render Download CSV button for non-completed analysis', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({ status: 'running', results: null })}
        projectId={PROJECT_ID}
      />
    )
    expect(
      screen.queryByRole('button', { name: /download csv/i })
    ).toBeNull()
  })
})
