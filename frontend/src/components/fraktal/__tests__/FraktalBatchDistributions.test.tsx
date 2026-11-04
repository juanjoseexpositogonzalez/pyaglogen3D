/**
 * Unit tests for `<FraktalBatchDistributions>` (frente 9, P3).
 *
 * Uses the same Plotly + next/dynamic mock pattern established in
 * `RgEvolutionChart.test.tsx` so the component renders synchronously
 * under jsdom without WebGL.
 */
import { fireEvent, render, screen } from '@testing-library/react'
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
    const data =
      (props.data as Array<{
        marker?: { color?: string }
        x?: number[]
        xbins?: { start: number; end: number; size: number }
      }>) || []
    const layout =
      (props.layout as {
        barmode?: string
        xaxis?: { title?: { text?: string } }
      } | undefined) ?? {}
    // Expose trace marker colors so tests can assert overlay traces
    const traceColors = data.map((t) => t.marker?.color ?? '').join(',')
    // The plot's own inputs, so a test can check the values table against the
    // data the chart received rather than against a second computation of it.
    const values = data.map((t) => t.x ?? [])
    const bins = data[0]?.xbins ?? null
    return (
      <div
        data-testid="plotly"
        data-trace-count={String(data.length)}
        // The panel owns the title (issue #176 slice 3B), so the plot is
        // identified by the axis it measures rather than by a title it no
        // longer paints.
        data-xaxis-title={layout.xaxis?.title?.text ?? ''}
        data-trace-colors={traceColors}
        data-barmode={layout.barmode ?? ''}
        data-series-values={JSON.stringify(values)}
        data-xbins={JSON.stringify(bins)}
      />
    )
  },
}))

// Imports AFTER mocks.
import {
  FraktalBatchDistributions,
  sturgesBuckets,
} from '../FraktalBatchDistributions'
import { series } from '@/lib/chart-theme'
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

/**
 * The approximate overlay's yellow. Canonical `fraktal-batch-distributions` R3
 * names it ("yellow sub-bar", "in yellow only"), and the kit's series ramp has
 * no yellow, so this value is the contract's, not a palette choice.
 */
const APPROXIMATE_YELLOW = '#eab308'

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

    it('each plot measures its own metric on the x axis', () => {
      const images = makeBatch(8, 2)
      render(<FraktalBatchDistributions images={images} />)
      const axes = screen
        .getAllByTestId('plotly')
        .map((p) => p.getAttribute('data-xaxis-title') ?? '')
      // The panel title names the metric and the hint carries the counts (see
      // "distributions on the kit"); the plot itself only needs its axis.
      expect(axes).toEqual(['Df', 'kf', 'Rg (nm)', 'npo'])
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
      expect(plots[0].getAttribute('data-xaxis-title')).toBe('Df')
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
        p.getAttribute('data-xaxis-title') === 'Df',
      )
      expect(dfPlot).toBeTruthy()
      // Df should have 2 traces (converged + approximate)
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('2')
      // The main bars take the kit's series ramp; the approximate overlay is
      // yellow, which canonical R3 fixes by name ("yellow sub-bar").
      const colors = dfPlot!.getAttribute('data-trace-colors') ?? ''
      expect(colors).toContain(series(0))
      expect(colors).toContain(APPROXIMATE_YELLOW)
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
        p.getAttribute('data-xaxis-title') === 'Df',
      )
      expect(dfPlot).toBeTruthy()
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('1')
      // Only the converged trace
      const colors = dfPlot!.getAttribute('data-trace-colors') ?? ''
      expect(colors).toContain(series(0))
      expect(colors).not.toContain(APPROXIMATE_YELLOW)
    })

    it('all-approximate batch: Df histogram has 1 trace (approximate only)', () => {
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
        p.getAttribute('data-xaxis-title') === 'Df',
      )
      expect(dfPlot).toBeTruthy()
      expect(dfPlot!.getAttribute('data-trace-count')).toBe('1')
      // Only the approximate trace, and it is yellow (canonical R3)
      const colors = dfPlot!.getAttribute('data-trace-colors') ?? ''
      expect(colors).toContain(APPROXIMATE_YELLOW)
      expect(colors).not.toContain(series(0))
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
        p.getAttribute('data-xaxis-title') === 'Df',
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
        (p) => p.getAttribute('data-xaxis-title') !== 'Df',
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
      expect(dfStats.textContent).toContain('mean 1.80')
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
      expect(dfStats.textContent).toContain('mean 1.80')
      // Inclusive line visible with different value
      const inclusive = screen.getByTestId('distribution-df-inclusive')
      expect(inclusive.textContent).toContain('1.74')
    })

    it('no inclusive shown when mean_df_inclusive is null (legacy server)', () => {
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
        // no n_converged, no mean_df_inclusive — legacy response
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

  describe('Quality count subtitle (T5.6)', () => {
    it('mixed batch: shows converged and approximate counts', () => {
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 10 }, (_, i) =>
          makeImage(i, { quality: 'converged' }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeImage(10 + i, {
            quality: 'approximate',
            fractal_dimension: 1.90 + i * 0.01,
          }),
        ),
      ]
      const batchStats: Partial<FraktalBatchStats> = {
        n_images: 13,
        n_successful: 13,
        mean_df: 1.80,
        std_df: 0.05,
        median_df: 1.79,
        q1_df: 1.76,
        q3_df: 1.83,
        min_df: 1.72,
        max_df: 1.95,
        n_converged: 10,
        n_approximate: 3,
        n_excluded: 0,
        n_failed: 0,
        mean_df_inclusive: 1.76,
        df: { mean: 1.80, std: 0.05, median: 1.79, min: 1.72, max: 1.95 },
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
      const subtitle = screen.getByTestId('distribution-df-quality-counts')
      expect(subtitle.textContent).toContain('10 converged')
      expect(subtitle.textContent).toContain('3 approximate')
    })

    it('all-converged batch: shows only converged count, no approximate mention', () => {
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
        mean_df_inclusive: 1.80,
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
      const subtitle = screen.getByTestId('distribution-df-quality-counts')
      expect(subtitle.textContent).toContain('8 converged')
      expect(subtitle.textContent).not.toContain('approximate')
    })

    it('no quality counts shown when batch stats lack quality counters (legacy)', () => {
      const images = makeBatch(8, 0)
      // No stats provided (legacy server — no quality counters)
      render(<FraktalBatchDistributions images={images} />)
      expect(
        screen.queryByTestId('distribution-df-quality-counts'),
      ).toBeNull()
    })
  })

  // --- Issue #176 slice 3B: each distribution is a kit panel ---------------
  describe('distributions on the kit (issue #176 3B)', () => {
    it('gives every distribution its own titled panel', () => {
      render(<FraktalBatchDistributions images={makeBatch(10, 0)} />)
      const headings = screen
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent)
      expect(headings).toEqual([
        'Df (fractal dimension)',
        'kf (prefactor)',
        'Rg (radius of gyration)',
        'npo (primary count)',
      ])
    })

    it('labels every panel "N successful of M total" (canonical R3)', () => {
      render(<FraktalBatchDistributions images={makeBatch(8, 2)} />)
      // `fraktal-batch-distributions` R3 fixes this wording verbatim: the
      // panel must say "8 successful of 10 total", not a paraphrase.
      expect(screen.getAllByText('8 successful of 10 total').length).toBe(4)
    })

    it('keeps the per-metric empty state inside its own panel', () => {
      render(<FraktalBatchDistributions images={makeBatch(4, 1)} />)
      const empty = screen.getByTestId('distribution-df-not-enough')
      expect(empty.closest('section')).toBeTruthy()
      expect(empty.textContent).toContain('4')
    })

    it('replaces the whole grid with one empty state when nothing was measured', () => {
      render(<FraktalBatchDistributions images={makeBatch(0, 5)} />)
      const empty = screen.getByTestId('fraktal-batch-distributions-empty')
      expect(empty.textContent).toContain('all 5 images failed')
      expect(screen.queryAllByTestId('plotly')).toHaveLength(0)
    })

    it('draws the main bars from the kit series ramp, never from the Tailwind palette', () => {
      render(<FraktalBatchDistributions images={makeBatch(10, 0)} />)
      const colors = screen
        .getAllByTestId('plotly')
        .map((p) => p.getAttribute('data-trace-colors') ?? '')
        .join(',')
      expect(colors).toContain(series(0))
      // The palette the pre-migration component reached for. Yellow is the one
      // value the contract keeps, and only for the approximate overlay, which
      // this fixture has none of.
      expect(colors).not.toContain('#3b82f6')
      expect(colors).not.toContain('#1e40af')
      expect(colors).not.toContain(APPROXIMATE_YELLOW)
    })
  })

  // --- R7 (design-system-foundation): the values behind every histogram -----
  describe('Show values on every histogram (R7)', () => {
    /** Bins one trace's values exactly as the chart's own `xbins` prescribe. */
    function countsFor(
      values: number[],
      bins: { start: number; end: number; size: number },
    ): number[] {
      const k = Math.max(1, Math.round((bins.end - bins.start) / bins.size))
      const counts = Array.from({ length: k }, () => 0)
      for (const v of values) {
        const index = Math.min(k - 1, Math.floor((v - bins.start) / bins.size))
        if (index >= 0) counts[index] += 1
      }
      return counts
    }

    /** The numeric cells of one table column, read off the rendered rows. */
    function columnValues(columnIndex: number): number[] {
      const rows = Array.from(document.querySelectorAll('tbody tr'))
      return rows.map((row) => {
        const cells = row.querySelectorAll('td')
        return Number((cells[columnIndex].textContent ?? '').replace(/,/g, ''))
      })
    }

    it('puts the control in every panel header', () => {
      render(<FraktalBatchDistributions images={makeBatch(10, 0)} />)
      const toggles = screen.getAllByRole('button', { name: /show values/i })
      expect(toggles).toHaveLength(4)
      toggles.forEach((toggle) => {
        const panel = toggle.closest('section')
        expect(panel?.querySelector('h2')).toBeTruthy()
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
      })
    })

    it('replaces the chart with the table in the same panel frame', () => {
      render(<FraktalBatchDistributions images={makeBatch(10, 0)} />)
      expect(screen.getAllByTestId('plotly')).toHaveLength(4)

      fireEvent.click(screen.getAllByRole('button', { name: /show values/i })[0])

      // Three charts left; the Df chart is gone and a table took its place.
      expect(screen.getAllByTestId('plotly')).toHaveLength(3)
      const tables = screen.getAllByRole('table')
      expect(tables).toHaveLength(1)
      // Same frame: the table sits inside the panel that held the chart.
      const panel = tables[0].closest('section')
      expect(panel?.querySelector('h2')?.textContent).toBe('Df (fractal dimension)')
      // And the control now offers the chart back.
      const toggle = screen.getByRole('button', { name: /show chart/i })
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
    })

    it('tabulates the buckets the chart is actually given', () => {
      render(<FraktalBatchDistributions images={makeBatch(10, 0)} />)
      const dfPlot = screen
        .getAllByTestId('plotly')
        .find((p) => p.getAttribute('data-xaxis-title') === 'Df')
      expect(dfPlot).toBeTruthy()
      const bins = JSON.parse(dfPlot?.getAttribute('data-xbins') ?? 'null')
      const values = JSON.parse(dfPlot?.getAttribute('data-series-values') ?? '[]')[0]
      expect(bins).toBeTruthy()

      fireEvent.click(screen.getAllByRole('button', { name: /show values/i })[0])

      // The bucket boundaries are the chart's own, not a second computation.
      const headers = Array.from(document.querySelectorAll('thead th')).map(
        (th) => th.textContent,
      )
      expect(headers).toEqual(['From', 'To', 'Count'])
      const from = columnValues(0)
      const to = columnValues(1)
      const counts = columnValues(2)
      expect(from).toHaveLength(countsFor(values, bins).length)
      expect(from[0]).toBeCloseTo(bins.start, 3)
      expect(to[to.length - 1]).toBeCloseTo(bins.end, 3)
      expect(counts).toEqual(countsFor(values, bins))
      // Every value the chart draws is accounted for exactly once.
      expect(counts.reduce((a, b) => a + b, 0)).toBe(values.length)
    })

    it('tabulates both series of the Df overlay', () => {
      const images: FraktalBatchImageResult[] = [
        ...Array.from({ length: 5 }, (_, i) => makeImage(i, { quality: 'converged' })),
        ...Array.from({ length: 3 }, (_, i) =>
          makeImage(5 + i, {
            quality: 'approximate',
            fractal_dimension: 1.95 + i * 0.01,
          }),
        ),
      ]
      render(<FraktalBatchDistributions images={images} />)
      const dfPlot = screen
        .getAllByTestId('plotly')
        .find((p) => p.getAttribute('data-xaxis-title') === 'Df')
      expect(dfPlot).toBeTruthy()
      const bins = JSON.parse(dfPlot?.getAttribute('data-xbins') ?? 'null')
      const seriesValues = JSON.parse(dfPlot?.getAttribute('data-series-values') ?? '[]')

      fireEvent.click(screen.getAllByRole('button', { name: /show values/i })[0])

      const headers = Array.from(document.querySelectorAll('thead th')).map(
        (th) => th.textContent,
      )
      expect(headers).toEqual(['From', 'To', 'Converged', 'Approximate'])
      expect(columnValues(2)).toEqual(countsFor(seriesValues[0], bins))
      expect(columnValues(3)).toEqual(countsFor(seriesValues[1], bins))
    })

    it('does not offer a table where there is no chart', () => {
      render(<FraktalBatchDistributions images={makeBatch(4, 1)} />)
      // Every metric is below the minimum: four panels, no charts, no toggles.
      expect(screen.queryAllByTestId('plotly')).toHaveLength(0)
      expect(screen.queryAllByRole('button', { name: /show values/i })).toHaveLength(0)
    })
  })

  // --- The Sim-Df marker never appears over a plotless panel ----------------
  describe('Sim Df marker without a chart', () => {
    it('renders no marker control in the "Not enough data" state', () => {
      render(
        <FraktalBatchDistributions
          images={makeBatch(4, 1)}
          studyComparison={
            {
              sim_id: 'sim-1',
              images_with_df: 4,
              images_without_df: 0,
              image_df: {
                n: 4,
                mean: 1.8,
                median: 1.8,
                min: 1.78,
                max: 1.82,
                n_converged: 4,
                n_approximate: 0,
              },
              sim_df: { value: 2.42, target_df: 2.3 },
              mean_delta: -0.62,
              deltas: [],
              show_sorensen_note: true,
            }
          }
        />,
      )
      // A checkbox that changes nothing is a control that lies.
      expect(screen.queryByTestId('sim-marker-toggle')).toBeNull()
    })
  })
})
