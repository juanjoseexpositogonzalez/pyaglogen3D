/**
 * Unit tests for `<FraktalBatchDistributions>` (frente 9, P3).
 *
 * Uses the same Plotly + next/dynamic mock pattern established in
 * `RgEvolutionChart.test.tsx` so the component renders synchronously
 * under jsdom without WebGL.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/dynamic', () => ({
  default: (
    loader: () => Promise<{ default: React.ComponentType<unknown> }>,
  ) => {
    let Comp: React.ComponentType<unknown> | null = null
    loader().then((mod) => {
      Comp = mod.default
    })
    return function DynamicStub(props: Record<string, unknown>) {
      if (!Comp) return null
      return React.createElement(Comp, props)
    }
  },
}))

vi.mock('react-plotly.js', () => ({
  default: (props: Record<string, unknown>) => {
    const data = (props.data as Array<{ marker?: { color?: string } }>) || []
    const layout =
      (props.layout as {
        title?: { text?: string }
        barmode?: string
      } | undefined) ?? {}
    // Expose trace marker colors so tests can assert overlay traces
    const traceColors = data.map((t) => t.marker?.color ?? '').join(',')
    return (
      <div
        data-testid="plotly"
        data-trace-count={String(data.length)}
        data-title={layout.title?.text ?? ''}
        data-trace-colors={traceColors}
        data-barmode={layout.barmode ?? ''}
      />
    )
  },
}))

// Imports AFTER mocks.
import {
  FraktalBatchDistributions,
  sturgesBuckets,
} from '../FraktalBatchDistributions'
import type { FraktalBatchImageResult, FraktalBatchStats } from '@/lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImage(
  index: number,
  overrides: Partial<FraktalBatchImageResult> = {},
): FraktalBatchImageResult {
  return {
    index,
    filename: `img_${index}.png`,
    azimuth: 0,
    elevation: 0,
    fractal_dimension: 1.78 + (index % 5) * 0.01,
    prefactor: 1.4 + (index % 3) * 0.05,
    r_squared: 0.99,
    n_particles_counted: 350 + index,
    rg_nm: 150 + index * 2,
    error: null,
    ...overrides,
  }
}

function makeBatch(nSucc: number, nFailed: number): FraktalBatchImageResult[] {
  const succ = Array.from({ length: nSucc }, (_, i) => makeImage(i))
  const failed = Array.from({ length: nFailed }, (_, i) =>
    makeImage(nSucc + i, {
      error: 'Bisection method failed to converge',
      fractal_dimension: null,
      prefactor: null,
      rg_nm: null,
      n_particles_counted: null,
    }),
  )
  return [...succ, ...failed]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sturgesBuckets', () => {
  it('clamps to minimum 3 for tiny inputs', () => {
    expect(sturgesBuckets(1)).toBe(3)
    expect(sturgesBuckets(2)).toBe(3)
    expect(sturgesBuckets(0)).toBe(3)
  })

  it('returns 5 for n=10 (canonical Sturges)', () => {
    // log2(10) + 1 ≈ 4.32 → ceil = 5
    expect(sturgesBuckets(10)).toBe(5)
  })

  it('returns 8 for n=100', () => {
    // log2(100) + 1 ≈ 7.64 → ceil = 8
    expect(sturgesBuckets(100)).toBe(8)
  })

  it('returns 11 for n=1000', () => {
    // log2(1000) + 1 ≈ 10.97 → ceil = 11
    expect(sturgesBuckets(1000)).toBe(11)
  })

  it('clamps to maximum 30 for very large inputs', () => {
    expect(sturgesBuckets(1_000_000_000)).toBe(30)
  })
})

describe('<FraktalBatchDistributions>', () => {
  describe('happy path', () => {
    it('renders 4 plots when all metrics have ≥ 5 successful values', () => {
      const images = makeBatch(10, 0)
      render(<FraktalBatchDistributions images={images} />)
      // 4 plots, one per metric
      const plots = screen.getAllByTestId('plotly')
      expect(plots).toHaveLength(4)
    })

    it('plot titles include "(N succ / M total)" format', () => {
      const images = makeBatch(8, 2)
      render(<FraktalBatchDistributions images={images} />)
      const plots = screen.getAllByTestId('plotly')
      // All 4 plot titles should contain "8 succ / 10 total"
      const titles = plots.map((p) => p.getAttribute('data-title') ?? '')
      titles.forEach((t) => {
        expect(t).toContain('8 succ / 10 total')
      })
      // And each metric label is present in exactly one title
      expect(titles.some((t) => t.includes('Df'))).toBe(true)
      expect(titles.some((t) => t.includes('kf'))).toBe(true)
      expect(titles.some((t) => t.includes('Rg'))).toBe(true)
      expect(titles.some((t) => t.includes('npo'))).toBe(true)
    })

    it('renders the 2x2 grid container', () => {
      const images = makeBatch(10, 0)
      render(<FraktalBatchDistributions images={images} />)
      expect(
        screen.getByTestId('fraktal-batch-distributions'),
      ).toBeTruthy()
    })
  })

  describe('edge cases', () => {
    it('shows global "no data" when all images failed', () => {
      const images = makeBatch(0, 5)
      render(<FraktalBatchDistributions images={images} />)
      expect(
        screen.getByTestId('fraktal-batch-distributions-empty'),
      ).toBeTruthy()
      expect(screen.queryByTestId('plotly')).toBeNull()
    })

    it('shows "Not enough data" per-metric when < 5 successful', () => {
      const images = makeBatch(4, 1)
      render(<FraktalBatchDistributions images={images} />)
      // No plots rendered (each metric has 4 successful values, threshold is 5)
      expect(screen.queryAllByTestId('plotly')).toHaveLength(0)
      // Each metric shows the "not enough" placeholder
      expect(
        screen.getByTestId('distribution-df-not-enough'),
      ).toBeTruthy()
      expect(
        screen.getByTestId('distribution-kf-not-enough'),
      ).toBeTruthy()
      expect(
        screen.getByTestId('distribution-rg-not-enough'),
      ).toBeTruthy()
      expect(
        screen.getByTestId('distribution-npo-not-enough'),
      ).toBeTruthy()
    })

    it('handles single value (zero variance) — Plotly receives identical values', () => {
      const images: FraktalBatchImageResult[] = Array.from(
        { length: 8 },
        (_, i) =>
          makeImage(i, {
            fractal_dimension: 1.78,
            prefactor: 1.4,
            rg_nm: 150,
            n_particles_counted: 350,
          }),
      )
      render(<FraktalBatchDistributions images={images} />)
      // 4 plots still render — Plotly handles single bar naturally
      expect(screen.getAllByTestId('plotly')).toHaveLength(4)
    })

    it('mixed: some metrics pass threshold, others do not (defensive)', () => {
      // 6 images: all have df, but only 3 have kf/rg/npo
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 3 }, (_, i) => makeImage(i)),
        ...Array.from({ length: 3 }, (_, i) =>
          makeImage(3 + i, {
            // df present, others null (atypical but defensive)
            prefactor: null,
            rg_nm: null,
            n_particles_counted: null,
          }),
        ),
      ]
      render(<FraktalBatchDistributions images={images} />)
      // df has 6 successful → renders plot
      // kf, rg, npo have 3 each (below 5) → not enough
      const plots = screen.getAllByTestId('plotly')
      expect(plots).toHaveLength(1)
      expect(plots[0].getAttribute('data-title')).toContain('Df')
    })
  })

  describe('Df yellow overlay (T5.4)', () => {
    it('mixed batch: Df histogram has 2 traces (converged blue + approximate yellow)', () => {
      // 5 converged + 2 approximate (all with valid Df-related values)
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeImage(i, { quality: 'converged' }),
        ),
        ...Array.from({ length: 2 }, (_, i) =>
          makeImage(5 + i, {
            quality: 'approximate',
            fractal_dimension: 1.90 + i * 0.01,
          }),
        ),
      ]
      render(<FraktalBatchDistributions images={images} />)
      const plots = screen.getAllByTestId('plotly')
      // Find the Df plot
      const dfPlot = plots.find((p) =>
        (p.getAttribute('data-title') ?? '').includes('Df'),
      )
      expect(dfPlot).toBeTruthy()
      // Df should have 2 traces (converged + approximate)
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('2')
      // Trace colors: first blue (#3b82f6), second yellow (#eab308)
      const colors = dfPlot!.getAttribute('data-trace-colors') ?? ''
      expect(colors).toContain('#3b82f6')
      expect(colors).toContain('#eab308')
      // barmode overlay
      expect(dfPlot!.getAttribute('data-barmode')).toBe('overlay')
    })

    it('all-converged batch: Df histogram has 1 trace (no overlay)', () => {
      const images: FraktalBatchImageResult[] = Array.from(
        { length: 8 },
        (_, i) => makeImage(i, { quality: 'converged' }),
      )
      render(<FraktalBatchDistributions images={images} />)
      const plots = screen.getAllByTestId('plotly')
      const dfPlot = plots.find((p) =>
        (p.getAttribute('data-title') ?? '').includes('Df'),
      )
      expect(dfPlot).toBeTruthy()
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('1')
      // Only blue trace
      const colors = dfPlot!.getAttribute('data-trace-colors') ?? ''
      expect(colors).toContain('#3b82f6')
      expect(colors).not.toContain('#eab308')
    })

    it('all-approximate batch: Df histogram has 1 trace (yellow only)', () => {
      const images: FraktalBatchImageResult[] = Array.from(
        { length: 6 },
        (_, i) =>
          makeImage(i, {
            quality: 'approximate',
            fractal_dimension: 1.85 + i * 0.01,
          }),
      )
      render(<FraktalBatchDistributions images={images} />)
      const plots = screen.getAllByTestId('plotly')
      const dfPlot = plots.find((p) =>
        (p.getAttribute('data-title') ?? '').includes('Df'),
      )
      expect(dfPlot).toBeTruthy()
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('1')
      // Only yellow trace, no blue
      const colors = dfPlot!.getAttribute('data-trace-colors') ?? ''
      expect(colors).toContain('#eab308')
      expect(colors).not.toContain('#3b82f6')
    })

    it('excluded/failed images omitted from Df overlay (only converged+approximate)', () => {
      // 5 converged + 1 approximate + 1 excluded + 1 failed = 8 total
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeImage(i, { quality: 'converged' }),
        ),
        makeImage(5, { quality: 'approximate', fractal_dimension: 1.92 }),
        makeImage(6, { quality: 'excluded', fractal_dimension: null }),
        makeImage(7, { quality: 'failed', fractal_dimension: null, error: 'fail' }),
      ]
      render(<FraktalBatchDistributions images={images} />)
      const plots = screen.getAllByTestId('plotly')
      const dfPlot = plots.find((p) =>
        (p.getAttribute('data-title') ?? '').includes('Df'),
      )
      expect(dfPlot).toBeTruthy()
      // 2 traces: converged (5 values) + approximate (1 value)
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('2')
    })

    it('non-Df metrics unaffected: always 1 trace regardless of quality', () => {
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeImage(i, { quality: 'converged' }),
        ),
        ...Array.from({ length: 2 }, (_, i) =>
          makeImage(5 + i, {
            quality: 'approximate',
            fractal_dimension: 1.90 + i * 0.01,
          }),
        ),
      ]
      render(<FraktalBatchDistributions images={images} />)
      const plots = screen.getAllByTestId('plotly')
      // kf, rg, npo should each have 1 trace
      const nonDfPlots = plots.filter(
        (p) => !(p.getAttribute('data-title') ?? '').includes('Df'),
      )
      expect(nonDfPlots.length).toBe(3)
      nonDfPlots.forEach((p) => {
        expect(p.getAttribute('data-trace-count')).toBe('1')
      })
    })
  })

  describe('Mean dual-display (T5.5)', () => {
    it('all-converged: only primary mean shown, no inclusive line', () => {
      const images = Array.from({ length: 8 }, (_, i) =>
        makeImage(i, { quality: 'converged' }),
      )
      const batchStats: Partial<FraktalBatchStats> = {
        n_images: 8,
        n_successful: 8,
        mean_df: 1.80,
        std_df: 0.05,
        median_df: 1.79,
        q1_df: 1.76,
        q3_df: 1.83,
        min_df: 1.72,
        max_df: 1.88,
        n_converged: 8,
        n_approximate: 0,
        n_excluded: 0,
        n_failed: 0,
        mean_df_inclusive: 1.80,  // same as mean_df
        df: { mean: 1.80, std: 0.05, median: 1.79, min: 1.72, max: 1.88 },
        kf: { mean: 1.45, std: 0.1, median: 1.44, min: 1.3, max: 1.6 },
        rg: { mean: 160, std: 10, median: 158, min: 140, max: 180 },
        npo: { mean: 355, std: 5, median: 354, min: 350, max: 360 },
      }
      render(
        <FraktalBatchDistributions
          images={images}
          stats={batchStats as FraktalBatchStats}
        />,
      )
      // Primary mean should be visible
      const dfStats = screen.getByTestId('distribution-df-stats')
      expect(dfStats.textContent).toContain('mean=1.80')
      // No inclusive line (values are equal)
      expect(screen.queryByTestId('distribution-df-inclusive')).toBeNull()
    })

    it('mixed batch: both primary and inclusive mean visible with different values', () => {
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 6 }, (_, i) =>
          makeImage(i, { quality: 'converged', fractal_dimension: 1.80 }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeImage(6 + i, {
            quality: 'approximate',
            fractal_dimension: 1.60 + i * 0.01,
          }),
        ),
      ]
      const batchStats: Partial<FraktalBatchStats> = {
        n_images: 9,
        n_successful: 9,
        mean_df: 1.80,
        std_df: 0.03,
        median_df: 1.80,
        q1_df: 1.78,
        q3_df: 1.82,
        min_df: 1.72,
        max_df: 1.88,
        n_converged: 6,
        n_approximate: 3,
        n_excluded: 0,
        n_failed: 0,
        mean_df_inclusive: 1.74,  // different from mean_df
        df: { mean: 1.80, std: 0.03, median: 1.80, min: 1.72, max: 1.88 },
        kf: { mean: 1.45, std: 0.1, median: 1.44, min: 1.3, max: 1.6 },
        rg: { mean: 160, std: 10, median: 158, min: 140, max: 180 },
        npo: { mean: 355, std: 5, median: 354, min: 350, max: 360 },
      }
      render(
        <FraktalBatchDistributions
          images={images}
          stats={batchStats as FraktalBatchStats}
        />,
      )
      // Primary mean visible
      const dfStats = screen.getByTestId('distribution-df-stats')
      expect(dfStats.textContent).toContain('mean=1.80')
      // Inclusive line visible with different value
      const inclusive = screen.getByTestId('distribution-df-inclusive')
      expect(inclusive.textContent).toContain('1.74')
    })

    it('hidden when mean_df_inclusive equals mean_df', () => {
      const images = Array.from({ length: 6 }, (_, i) =>
        makeImage(i, { quality: 'converged' }),
      )
      const batchStats: Partial<FraktalBatchStats> = {
        n_images: 6,
        n_successful: 6,
        mean_df: 1.80,
        std_df: 0.04,
        median_df: 1.79,
        q1_df: 1.76,
        q3_df: 1.83,
        min_df: 1.72,
        max_df: 1.88,
        n_converged: 6,
        n_approximate: 0,
        mean_df_inclusive: 1.80,
        df: { mean: 1.80, std: 0.04, median: 1.79, min: 1.72, max: 1.88 },
        kf: { mean: 1.45, std: 0.1, median: 1.44, min: 1.3, max: 1.6 },
        rg: { mean: 160, std: 10, median: 158, min: 140, max: 180 },
        npo: { mean: 355, std: 5, median: 354, min: 350, max: 360 },
      }
      render(
        <FraktalBatchDistributions
          images={images}
          stats={batchStats as FraktalBatchStats}
        />,
      )
      expect(screen.queryByTestId('distribution-df-inclusive')).toBeNull()
    })
  })
})
