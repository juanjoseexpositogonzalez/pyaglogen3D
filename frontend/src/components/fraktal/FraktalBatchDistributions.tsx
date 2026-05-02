'use client'

/**
 * FraktalBatchDistributions — 4 histograms (Df, kf, Rg, npo) in a 2×2 grid.
 *
 * Rendered in the batch summary view so that distributions are persistent
 * (visible whenever the user navigates back to a batch, not only "fresh"
 * after upload completion). Replaces the missing-on-revisit Df histogram
 * limitation that the user reported in frente 9.
 *
 * Bucket count: Sturges' rule `k = ceil(log2(n) + 1)`, clamped to [3, 30].
 *
 * Edge cases:
 *  - n_successful < 5 for a metric → "Not enough data" message, no plot
 *  - n_successful = 0 globally → single "No data — all images failed" message
 *  - All values identical (zero variance) → Plotly renders a single bar
 *  - Stats block missing on response (legacy server) → compute inline as fallback
 */
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { PlotParams } from 'react-plotly.js'

import type {
  FraktalBatchImageResult,
  FraktalBatchStats,
  FraktalMetricStats,
} from '@/lib/api'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FraktalBatchDistributionsProps {
  images: FraktalBatchImageResult[]
  stats?: FraktalBatchStats
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sturges' rule: `k = ceil(log2(n) + 1)`, clamped to [3, 30].
 *
 * For n=10 → 5 buckets; n=100 → 8; n=1000 → 11. The clamp at 30 prevents
 * over-binning for very large batches; the clamp at 3 keeps the histogram
 * visually meaningful for small batches that pass the n_successful>=5 gate.
 */
export function sturgesBuckets(n: number): number {
  if (n <= 0) return 3
  const k = Math.ceil(Math.log2(n) + 1)
  return Math.max(3, Math.min(30, k))
}

type MetricKey = 'df' | 'kf' | 'rg' | 'npo'

interface MetricSpec {
  key: MetricKey
  label: string
  /** Pluck the value from an image row. Returns null/undefined when the
   *  image failed or the field is missing (legacy responses without rg_nm). */
  extract: (img: FraktalBatchImageResult) => number | null | undefined
  /** X-axis label (with units when applicable). */
  axisTitle: string
}

const METRICS: MetricSpec[] = [
  {
    key: 'df',
    label: 'Df (fractal dimension)',
    extract: (img) => img.fractal_dimension,
    axisTitle: 'Df',
  },
  {
    key: 'kf',
    label: 'kf (prefactor)',
    extract: (img) => img.prefactor,
    axisTitle: 'kf',
  },
  {
    key: 'rg',
    label: 'Rg (radius of gyration)',
    extract: (img) => img.rg_nm,
    axisTitle: 'Rg (nm)',
  },
  {
    key: 'npo',
    label: 'npo (primary count)',
    extract: (img) => img.n_particles_counted,
    axisTitle: 'npo',
  },
]

const MIN_N_SUCCESSFUL = 5

/** Compute mean/std/median/min/max from a non-empty array of numbers. */
function computeMetricStats(values: number[]): FraktalMetricStats {
  if (values.length === 0) {
    return { mean: null, std: null, median: null, min: null, max: null }
  }
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(1, n - 1)
  const std = Math.sqrt(variance)
  const sorted = [...values].sort((a, b) => a - b)
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[(n - 1) / 2]
  return {
    mean,
    std,
    median,
    min: sorted[0],
    max: sorted[n - 1],
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FraktalBatchDistributions({
  images,
  stats,
  className,
}: FraktalBatchDistributionsProps) {
  // Pluck successful values per metric. "Successful" = error == null AND
  // metric value is not null. Each metric is filtered independently because
  // a row may succeed overall but lack a specific field (defensive).
  const perMetric = useMemo(() => {
    return METRICS.map((spec) => {
      const values = images
        .filter((img) => img.error == null)
        .map(spec.extract)
        .filter((v): v is number => v != null && Number.isFinite(v))
      const fallbackStats =
        stats && stats[spec.key] ? stats[spec.key]! : computeMetricStats(values)
      return { spec, values, stats: fallbackStats }
    })
  }, [images, stats])

  const totalImages = images.length
  const overallSuccessful = images.filter((img) => img.error == null).length

  // n_successful = 0 globally → single message, no grid.
  if (overallSuccessful === 0) {
    return (
      <div
        className={
          'rounded border border-dashed border-muted-foreground/40 ' +
          'p-6 text-center text-sm text-muted-foreground ' +
          (className ?? '')
        }
        data-testid="fraktal-batch-distributions-empty"
      >
        No data — all {totalImages} images failed analysis.
      </div>
    )
  }

  return (
    <div
      className={
        'grid grid-cols-1 gap-4 md:grid-cols-2 ' + (className ?? '')
      }
      data-testid="fraktal-batch-distributions"
    >
      {perMetric.map(({ spec, values, stats: metricStats }) => (
        <DistributionCard
          key={spec.key}
          spec={spec}
          values={values}
          stats={metricStats}
          totalImages={totalImages}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner: a single histogram card.
// ---------------------------------------------------------------------------

interface DistributionCardProps {
  spec: MetricSpec
  values: number[]
  stats: FraktalMetricStats
  totalImages: number
}

function DistributionCard({
  spec,
  values,
  stats,
  totalImages,
}: DistributionCardProps) {
  const nSucc = values.length
  const title = `${spec.label} (${nSucc} succ / ${totalImages} total)`

  if (nSucc < MIN_N_SUCCESSFUL) {
    return (
      <div
        className="rounded border border-dashed border-muted-foreground/40 p-4"
        data-testid={`distribution-${spec.key}-not-enough`}
      >
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          Not enough data: only {nSucc} image(s) succeeded out of{' '}
          {totalImages}. Minimum is {MIN_N_SUCCESSFUL}.
        </div>
      </div>
    )
  }

  const nBuckets = sturgesBuckets(nSucc)

  const data: PlotParams['data'] = [
    {
      x: values,
      type: 'histogram',
      // @ts-expect-error nbinsx is a valid Plotly histogram prop but missing
      // from the @types/plotly.js Partial<PlotData> definition.
      nbinsx: nBuckets,
      marker: { color: '#3b82f6', line: { color: '#1e40af', width: 1 } },
    },
  ]

  const layout: PlotParams['layout'] = {
    autosize: true,
    margin: { l: 50, r: 20, t: 36, b: 40 },
    height: 260,
    title: { text: title, font: { size: 13 } },
    xaxis: { title: { text: spec.axisTitle } },
    yaxis: { title: { text: 'count' } },
    showlegend: false,
  }

  return (
    <div
      className="rounded border bg-card p-2"
      data-testid={`distribution-${spec.key}`}
    >
      <Plot
        data={data}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
        useResizeHandler
      />
      {stats.mean != null && (
        <div
          className="px-2 pb-1 text-xs text-muted-foreground"
          data-testid={`distribution-${spec.key}-stats`}
        >
          mean={stats.mean.toFixed(2)} ± {(stats.std ?? 0).toFixed(2)} ·
          median={stats.median?.toFixed(2)} · min=
          {stats.min?.toFixed(2)} · max={stats.max?.toFixed(2)}
        </div>
      )}
    </div>
  )
}

export default FraktalBatchDistributions
