/**
 * Swap-point + bulk re-analysis tests for <FraktalBatchResultsView />
 * (R12.3 + R13, change: fraktal-batch-extensions).
 *
 * R12.3: BatchStudyComparisonCard REPLACES FraktalComparisonCard at the
 * shared swap point (mounted by BOTH the SummaryPage and the live page —
 * both swap, no prop fork). Renders when study_comparison is non-null;
 * the NULL branch shows NO card and NO legacy fallback — the test MUST
 * distinguish the two. Exactly one Sorensen note per page.
 *
 * R13/T6: bulk failed-image re-analysis button with progress, wired to
 * fraktalApi.reanalyzeFailedBatch + onResultUpdate.
 *
 * Note: this repo's vitest setup does NOT load @testing-library/jest-dom
 * (see src/test/setup.ts) — assertions use plain matchers.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockReanalyzeFailedBatch } = vi.hoisted(() => ({
  mockReanalyzeFailedBatch: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      reanalyzeFailedBatch: mockReanalyzeFailedBatch,
    },
  }
})

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
  default: () => () => <div data-testid="plot" />,
}))

import { FraktalBatchResultsView } from '../FraktalBatchResultsView'
import type {
  FraktalBatchImageResult,
  FraktalBatchResult,
  FraktalStudyComparison,
} from '@/lib/api'

function makeImage(index: number): FraktalBatchImageResult {
  return {
    index,
    filename: `proj_${String(index).padStart(3, '0')}.png`,
    azimuth: index * 10,
    elevation: 0,
    fractal_dimension: 1.7 + 0.01 * index,
    prefactor: 1.5,
    r_squared: 0.99,
    n_particles_counted: 42,
    rg_nm: 150,
    error: null,
    quality: 'converged',
    df_estimate: null,
  }
}

function makeResult(
  overrides: Partial<FraktalBatchResult> = {}
): FraktalBatchResult {
  return {
    batch_id: 'batch-1',
    images: Array.from({ length: 10 }, (_, i) => makeImage(i)),
    stats: {
      n_images: 10,
      n_successful: 10,
      mean_df: 1.75,
      std_df: 0.03,
      median_df: 1.75,
      q1_df: 1.72,
      q3_df: 1.78,
      min_df: 1.7,
      max_df: 1.79,
      n_failed: 0,
    },
    histogram: null,
    comparison: {
      sim_id: '6d0b7a41-1111-4222-8333-444455556666',
      sim_name: 'sim',
      sim_target_df: 2.3,
      sim_box_counting_df: 2.42,
      batch_mean_df: 1.75,
      batch_std_df: 0.03,
      sorensen_note: 'Legacy note text',
    },
    study_comparison: null,
    calibration: {
      source: 'metadata',
      pixels_per_100nm: 500,
      dpo_used: 25,
      autocalibrate_image: null,
    },
    ...overrides,
  }
}

function makeStudyComparison(): FraktalStudyComparison {
  return {
    sim_id: '6d0b7a41-1111-4222-8333-444455556666',
    images_with_df: 10,
    images_without_df: 0,
    image_df: {
      n: 10,
      mean: 1.75,
      median: 1.75,
      min: 1.7,
      max: 1.79,
      n_converged: 10,
      n_approximate: 0,
    },
    sim_df: { value: 2.42, target_df: 2.3 },
    mean_delta: -0.67,
    deltas: Array.from({ length: 10 }, () => -0.67),
    show_sorensen_note: true,
  }
}

function renderView(result: FraktalBatchResult, onResultUpdate?: Mock) {
  return render(
    <FraktalBatchResultsView
      result={result}
      projectId="proj-1"
      batchId="batch-1"
      onResultUpdate={onResultUpdate}
    />
  )
}

beforeEach(() => {
  mockReanalyzeFailedBatch.mockReset()
})

describe('R12.3 — study_comparison swap point', () => {
  it('renders BatchStudyComparisonCard and NOT the legacy card when non-null', () => {
    renderView(makeResult({ study_comparison: makeStudyComparison() }))

    expect(screen.getByTestId('study-comparison-sim-df')).toBeTruthy()
    // No legacy fallback alongside: the legacy card's unique title/value
    // ("Df Comparison" / "Sim 3D box-counting") must be absent.
    expect(screen.queryByText('Df Comparison')).toBeNull()
    expect(screen.queryByText('Sim 3D box-counting')).toBeNull()
  })

  it('renders the canonical R11 Sorensen note EXACTLY ONCE per page', () => {
    renderView(makeResult({ study_comparison: makeStudyComparison() }))

    const notes = screen.getAllByTestId('study-comparison-sorensen-note')
    expect(notes).toHaveLength(1)
    // The note comes from the NEW card's canonical text, not from the
    // legacy comparison.sorensen_note string.
    expect(notes[0].textContent).toContain('Sorensen 1992')
    expect(screen.queryByText('Legacy note text')).toBeNull()
  })

  it('renders NO comparison card and NO legacy fallback when study_comparison is null', () => {
    // The real null case: a sim IS linked (comparison block non-null) but
    // its metric is missing / 0.0-sentinel / deleted. The legacy card must
    // NOT render — that would reintroduce the 0.0 rendering.
    renderView(makeResult({ study_comparison: null }))

    expect(screen.queryByTestId('study-comparison-sim-df')).toBeNull()
    expect(screen.queryByText('Df Comparison')).toBeNull()
    expect(screen.queryByText('Sim 3D box-counting')).toBeNull()
    expect(screen.queryByTestId('study-comparison-sorensen-note')).toBeNull()
  })

  it('treats an absent study_comparison key (legacy server) like null', () => {
    const result = makeResult()
    delete (result as Partial<FraktalBatchResult>).study_comparison
    renderView(result)

    expect(screen.queryByTestId('study-comparison-sim-df')).toBeNull()
    expect(screen.queryByText('Df Comparison')).toBeNull()
  })
})

describe('T6/R13 — bulk re-analyze failed button', () => {
  it('renders the button only when stats.n_failed > 0', () => {
    const { rerender } = renderView(makeResult())
    expect(screen.queryByTestId('reanalyze-failed-button')).toBeNull()

    rerender(
      <FraktalBatchResultsView
        result={makeResult({ stats: { ...makeResult().stats, n_failed: 4 } })}
        projectId="proj-1"
        batchId="batch-1"
      />
    )
    expect(
      screen.getByTestId('reanalyze-failed-button').textContent
    ).toContain('Re-analyze failed (4)')
  })

  it('calls reanalyzeFailedBatch and reports the refreshed payload', async () => {
    const updated = makeResult({
      stats: { ...makeResult().stats, n_failed: 0, n_successful: 14 },
      study_comparison: makeStudyComparison(),
    })
    mockReanalyzeFailedBatch.mockResolvedValueOnce(updated)
    const onResultUpdate = vi.fn()

    renderView(
      makeResult({ stats: { ...makeResult().stats, n_failed: 12 } }),
      onResultUpdate
    )

    fireEvent.click(screen.getByTestId('reanalyze-failed-button'))

    await waitFor(() => {
      expect(onResultUpdate).toHaveBeenCalledWith(updated)
    })
    expect(mockReanalyzeFailedBatch).toHaveBeenCalledWith(
      'proj-1',
      'batch-1',
      expect.any(Function)
    )
  })

  it('shows progress while the async job polls', async () => {
    let resolveJob: (r: FraktalBatchResult) => void = () => {}
    mockReanalyzeFailedBatch.mockImplementationOnce(
      (_p: string, _b: string, onProgress: (p: { progress: number }) => void) =>
        new Promise<FraktalBatchResult>((resolve) => {
          resolveJob = resolve
          onProgress({ progress: 0.45 })
        })
    )

    renderView(makeResult({ stats: { ...makeResult().stats, n_failed: 45 } }))

    fireEvent.click(screen.getByTestId('reanalyze-failed-button'))
    await waitFor(() => {
      expect(
        screen.getByTestId('reanalyze-failed-button').textContent
      ).toContain('Re-analyzing (45%)')
    })

    resolveJob(makeResult())
    await waitFor(() => {
      const btn = screen.getByTestId('reanalyze-failed-button') as HTMLButtonElement
      expect(btn.disabled).toBe(false)
    })
  })

  it('stays interactive when the re-analysis request fails', async () => {
    mockReanalyzeFailedBatch.mockRejectedValueOnce(new Error('403'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderView(makeResult({ stats: { ...makeResult().stats, n_failed: 12 } }))
    fireEvent.click(screen.getByTestId('reanalyze-failed-button'))

    await waitFor(() => {
      const btn = screen.getByTestId('reanalyze-failed-button') as HTMLButtonElement
      expect(btn.disabled).toBe(false)
    })
    consoleSpy.mockRestore()
  })
})
