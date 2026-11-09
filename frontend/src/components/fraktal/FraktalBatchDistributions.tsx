'use client'

/**
 * FraktalBatchDistributions — 4 histograms (Df, kf, Rg, npo) in a 2×2 grid
 * (frente 9; re-skinned on the design-system kit by issue #176, slice 3B).
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
 *
 * What the kit changed, and what it deliberately did not:
 *
 * - Every histogram is a `Panel`. The panel's title is the metric and its hint
 *   says how many images carry a value, which is why the plot no longer paints
 *   a title of its own: two titles for one box is one title too many.
 * - The main bars take their colour from `lib/chart-theme`, so they follow the
 *   active theme rather than a Tailwind palette constant painted once.
 * - The layout comes from `chart-theme.layout()`, so grid, ink and hover labels
 *   are the kit's.
 * - No data went: the bucket rule, the quality split, the dual mean, the
 *   quality counts and the Sim-Df reference marker are all unchanged.
 *
 * Two things a review put back, because the canonical spec had not changed:
 *
 * 1. The approximate overlay is **yellow** and the main bars are the kit's main
 *    series colour. Canonical `fraktal-batch-distributions` R3 names the colour
 *    ("rendered with a yellow overlay", "in yellow only"), the kit's series ramp
 *    has no yellow, and `--warning` is an ink for text rather than a bar fill —
 *    so `APPROXIMATE_YELLOW` is the one colour literal here, and it is the
 *    contract's, not a palette choice. Moving it to a ramp position is a spec
 *    delta and needs the owner's approval, not a test edited next to the code.
 * 2. Each panel carries the metadata label in the contract's own wording —
 *    `N successful of M total` — instead of a paraphrase. It is the panel's
 *    `hint`, which is above the chart, which R3 allows ("below or above each
 *    histogram panel").
 *
 * The buckets are computed here and handed to Plotly as explicit `xbins`, so
 * the chart and the values table cannot disagree: both are read off the same
 * `equalBins` result. Plotly's own autobinning rounds the edges to "nice"
 * numbers, which R2 does not ask for — R2 says the boundaries span [min, max]
 * evenly — so the explicit bins are also the rule the spec states.
 *
 * Every histogram is wrapped in `ShowValues` (R7 of `design-system-foundation`):
 * the control sits in the panel header and the table takes the chart's place,
 * one row per bucket and one column per series.
 */
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import type { PlotParams } from 'react-plotly.js'

import { Callout } from '@/components/kit/Callout'
import { type Column } from '@/components/kit/DataTable'
import { EmptyState } from '@/components/kit/EmptyState'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'
import { ShowValues } from '@/components/kit/ShowValues'
import { layout as chartLayout, series } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/useThemeStore'
import type {
  FraktalBatchImageResult,
  FraktalBatchStats,
  FraktalMetricStats,
  FraktalStudyComparison,
} from '@/lib/api'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FraktalBatchDistributionsProps {
  images: FraktalBatchImageResult[]
  stats?: FraktalBatchStats
  /** R-DELTA-C2 (fraktal-batch-extensions): non-null study_comparison
   *  enables the Sim-Df reference marker on the Df histogram. The marker
   *  reads `sim_df.value` from this block ONLY (single source; no separate
   *  top-level key exists). Hidden when null/undefined, toggle OFF, or the
   *  Df panel is in a no-data / "Not enough data" state. */
  studyComparison?: FraktalStudyComparison | null
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

/**
 * Series positions of the main trace and of the Sim-Df marker.
 *
 * Index, not colour: `series()` resolves the position against the ramp in
 * force, so the traces repaint with the theme instead of pinning a Tailwind
 * palette value into the plot.
 */
const SERIES_MAIN = 0
const SERIES_SIM_MARKER = 2

/**
 * The approximate overlay's fill.
 *
 * Canonical R3 names it twice — "a yellow sub-bar for the approximate values"
 * and "in yellow only" — so it is contract, not taste. The kit's ramp carries
 * teal, orange, violet, olive, magenta and slate and no yellow; `--warning` is
 * the semantic *ink* for text and its value would read as brown as a fill.
 * Declared here, with the pre-migration value, and changed only by a spec
 * delta.
 */
const APPROXIMATE_YELLOW = '#eab308'

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

/**
 * One histogram's binning: the edges, and the width between them.
 *
 * Equal-width buckets spanning [min, max], which is what canonical R2 states.
 * A zero-variance series collapses to a single bucket of width zero, which the
 * chart renders as one bar (R5) and the table as one row.
 */
interface Bins {
  start: number
  end: number
  /** Zero when every value is identical. */
  size: number
  edges: number[]
}

function equalBins(values: number[], k: number): Bins {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { start: 0, end: 0, size: 0, edges: [0, 0] }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (!(max > min)) return { start: min, end: min, size: 0, edges: [min, min] }
  const size = (max - min) / k
  const edges = Array.from({ length: k + 1 }, (_, i) => min + size * i)
  // The last edge is the maximum itself, not the maximum plus a float error.
  edges[k] = max
  return { start: min, end: max, size, edges }
}

/** How many of `values` fall in each bucket; the last bucket takes the maximum. */
function countsInto(values: number[], bins: Bins): number[] {
  const k = Math.max(1, bins.edges.length - 1)
  const counts = Array.from({ length: k }, () => 0)
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (bins.size === 0) {
      counts[0] += 1
      continue
    }
    const index = Math.min(k - 1, Math.max(0, Math.floor((value - bins.start) / bins.size)))
    counts[index] += 1
  }
  return counts
}

/** One row of the table behind a histogram: a bucket and its counts. */
interface BucketRow {
  from: number | null
  to: number | null
  converged: number | null
  approximate: number | null
  count: number | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FraktalBatchDistributions({
  images,
  stats,
  studyComparison,
  className,
}: FraktalBatchDistributionsProps) {
  // Repaint the plots with the ramp in force after a theme flip.
  useThemeStore((state) => state.resolved)

  // Pluck successful values per metric. "Successful" = error == null AND
  // metric value is not null. Each metric is filtered independently because
  // a row may succeed overall but lack a specific field (defensive).
  //
  // For Df specifically: split by quality (converged vs approximate) so the
  // histogram can render an overlay for approximate values (T5.4).
  const perMetric = useMemo(() => {
    return METRICS.map((spec) => {
      const successful = images.filter((img) => img.error == null)
      const values = successful
        .map(spec.extract)
        .filter((v): v is number => v != null && Number.isFinite(v))
      const fallbackStats =
        stats && stats[spec.key] ? stats[spec.key]! : computeMetricStats(values)

      // Quality-split for Df only (bisection-specific overlay)
      let convergedValues: number[] | undefined
      let approximateValues: number[] | undefined
      if (spec.key === 'df') {
        convergedValues = images
          .filter((img) => img.quality === 'converged')
          .map(spec.extract)
          .filter((v): v is number => v != null && Number.isFinite(v))
        approximateValues = images
          .filter((img) => img.quality === 'approximate')
          .map(spec.extract)
          .filter((v): v is number => v != null && Number.isFinite(v))
      }

      return { spec, values, stats: fallbackStats, convergedValues, approximateValues }
    })
  }, [images, stats])

  const totalImages = images.length
  const overallSuccessful = images.filter((img) => img.error == null).length

  // n_successful = 0 globally → single message, no grid.
  if (overallSuccessful === 0) {
    return (
      <div
        className={className}
        data-testid="fraktal-batch-distributions-empty"
      >
        <EmptyState
          headingLevel={3}
          title="No distributions to draw"
          description={`No data — all ${totalImages} images failed analysis.`}
        />
      </div>
    )
  }

  return (
    <div
      className={'grid grid-cols-1 gap-4 md:grid-cols-2 ' + (className ?? '')}
      data-testid="fraktal-batch-distributions"
    >
      {perMetric.map(({ spec, values, stats: metricStats, convergedValues, approximateValues }) => (
        <DistributionCard
          key={spec.key}
          spec={spec}
          values={values}
          stats={metricStats}
          totalImages={totalImages}
          convergedValues={convergedValues}
          approximateValues={approximateValues}
          batchStats={stats}
          studyComparison={spec.key === 'df' ? (studyComparison ?? null) : null}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner: a single histogram panel.
// ---------------------------------------------------------------------------

interface DistributionCardProps {
  spec: MetricSpec
  values: number[]
  stats: FraktalMetricStats
  totalImages: number
  /** Df-only: converged values for the primary trace. */
  convergedValues?: number[]
  /** Df-only: approximate values for the overlay trace. */
  approximateValues?: number[]
  /** Batch-level stats for mean_df_inclusive dual-display. */
  batchStats?: FraktalBatchStats
  /** R-DELTA-C2: non-null ONLY for the Df panel when the batch summary
   *  carries a study_comparison block (its sim_df.value is the single
   *  marker source). Null for every other metric. */
  studyComparison?: FraktalStudyComparison | null
}

function DistributionCard({
  spec,
  values,
  stats,
  totalImages,
  convergedValues,
  approximateValues,
  batchStats,
  studyComparison = null,
}: DistributionCardProps) {
  const nSucc = values.length
  // Canonical R3 fixes this wording verbatim; the panel's hint sits above the
  // chart, which is one of the two places R3 allows.
  const label = `${nSucc} successful of ${totalImages} total`

  // R-DELTA-C2: per-batch toggle, component-local state, default ON, NOT
  // persisted (the component has no persistence and this change adds none).
  // The marker renders ONLY when: studyComparison is non-null (same absence
  // rule as R12 — no sim / deleted sim / missing metric / 0.0 sentinel),
  // the toggle is ON, and the histogram itself renders (the no-data and
  // "Not enough data" branches below return before any Plot exists, so no
  // marker floats over a plotless panel).
  const [simMarkerEnabled, setSimMarkerEnabled] = useState(true)
  const simMarkerValue =
    spec.key === 'df' && studyComparison ? studyComparison.sim_df.value : null

  /**
   * The marker's switch. Only built where a chart or a values table exists: a
   * checkbox that changes nothing visible is a control that lies about what it
   * does, and the "Not enough data" branch has nothing for it to mark.
   */
  const markerToggle =
    spec.key === 'df' && studyComparison ? (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`sim-marker-toggle-${spec.key}`}
          checked={simMarkerEnabled}
          onChange={(e) => setSimMarkerEnabled(e.target.checked)}
          data-testid="sim-marker-toggle"
          className="h-3 w-3"
        />
        <label
          htmlFor={`sim-marker-toggle-${spec.key}`}
          className="cursor-pointer select-none text-[11px] text-ink-muted"
        >
          Show Sim Df marker
        </label>
      </div>
    ) : null

  if (nSucc < MIN_N_SUCCESSFUL) {
    return (
      <Panel title={spec.label} hint={label}>
        <div data-testid={`distribution-${spec.key}-not-enough`}>
          <Callout tone="info" title="Not enough data">
            Only {nSucc} image(s) succeeded out of {totalImages}. A distribution needs at
            least {MIN_N_SUCCESSFUL}.
          </Callout>
        </div>
      </Panel>
    )
  }

  const nBuckets = sturgesBuckets(nSucc)

  // Quality-split for Df only (bisection-specific overlay, canonical R3).
  const hasDfQualitySplit =
    spec.key === 'df' &&
    convergedValues !== undefined &&
    approximateValues !== undefined &&
    (convergedValues.length > 0 || approximateValues.length > 0)

  // The values this panel actually draws — one series, or the two quality
  // halves — so the binning covers exactly what the reader sees.
  const convergedDrawn = hasDfQualitySplit ? convergedValues ?? [] : values
  const approximateDrawn = hasDfQualitySplit ? approximateValues ?? [] : []
  const bins = equalBins([...convergedDrawn, ...approximateDrawn], nBuckets)
  const convergedCounts = countsInto(convergedDrawn, bins)
  const approximateCounts = hasDfQualitySplit ? countsInto(approximateDrawn, bins) : []

  // One row per bucket, one column per series: the table is the chart's own
  // binning read back, not a second computation of it.
  const rows: BucketRow[] = bins.edges.slice(0, -1).map((from, i) => ({
    from,
    to: bins.edges[i + 1],
    converged: hasDfQualitySplit ? convergedCounts[i] : null,
    approximate: hasDfQualitySplit ? approximateCounts[i] : null,
    count: hasDfQualitySplit ? null : convergedCounts[i],
  }))

  const columns: Column<BucketRow>[] = [
    { key: 'from', header: 'From', numeric: true, digits: 3, value: (row) => row.from },
    { key: 'to', header: 'To', numeric: true, digits: 3, value: (row) => row.to },
    ...(hasDfQualitySplit
      ? [
          {
            key: 'converged',
            header: 'Converged',
            numeric: true,
            digits: 0,
            value: (row: BucketRow) => row.converged,
          },
          {
            key: 'approximate',
            header: 'Approximate',
            numeric: true,
            digits: 0,
            value: (row: BucketRow) => row.approximate,
          },
        ]
      : [
          {
            key: 'count',
            header: 'Count',
            numeric: true,
            digits: 0,
            value: (row: BucketRow) => row.count,
          },
        ]),
  ]

  // Explicit bins: Plotly honours these instead of autobinning, which is what
  // keeps the chart and the table in step. A zero-variance series has no width
  // to hand over, so the trace falls back to Plotly's degenerate single bar.
  const xbins =
    bins.size > 0 ? { start: bins.start, end: bins.end, size: bins.size } : undefined

  // Build traces. For Df with quality data: split into the main series + the
  // yellow approximate overlay. For all other metrics: single trace.
  let data: PlotParams['data']
  let useOverlay = false

  if (hasDfQualitySplit) {
    const traces: PlotParams['data'] = []
    if (convergedDrawn.length > 0) {
      traces.push({
        x: convergedDrawn,
        type: 'histogram',
        marker: { color: series(SERIES_MAIN) },
        name: 'Converged',
        ...(xbins ? { xbins } : {}),
      })
    }
    if (approximateDrawn.length > 0) {
      traces.push({
        x: approximateDrawn,
        type: 'histogram',
        marker: { color: APPROXIMATE_YELLOW },
        name: 'Approximate',
        opacity: 0.7,
        ...(xbins ? { xbins } : {}),
      })
    }
    data = traces
    useOverlay = traces.length > 1
  } else {
    data = [
      {
        x: values,
        type: 'histogram',
        marker: { color: series(SERIES_MAIN) },
        ...(xbins ? { xbins } : {}),
      },
    ]
  }

  // The plot's layout is the kit's: paper ink, grid and hover label follow the
  // theme. Only the two axis titles are this panel's.
  const base = chartLayout({
    showlegend: hasDfQualitySplit && data.length > 1,
    ...(useOverlay ? { barmode: 'overlay' as const } : {}),
  })
  const baseX = base.xaxis as Record<string, unknown>
  const baseY = base.yaxis as Record<string, unknown>
  const layout = {
    ...base,
    height: 260,
    // No title inside the plot, so no band for one. The marker branch below
    // re-opens the top margin for its own annotation.
    margin: { l: 50, r: 20, t: 16, b: 40 },
    xaxis: { ...baseX, title: { text: spec.axisTitle } },
    yaxis: { ...baseY, title: { text: 'count' } },
  } as Record<string, unknown>

  // R-DELTA-C2 marker: dashed vertical line at x = study_comparison.
  // sim_df.value + a chip label near the top. PURELY ADDITIVE to the
  // layout — bucket computation (R2), degenerate rendering (R5), tooltip
  // breakdowns (R-DELTA-M), the "N successful of M total" label this panel
  // carries in its hint, and the global/per-metric no-data gates are untouched
  // by it. The bucket edges above are the table's and the chart's shared
  // source; nothing here writes to them.
  const targetDf = studyComparison?.sim_df.target_df ?? null
  if (simMarkerValue != null && simMarkerEnabled) {
    // Fix round F9 (judgment-day): Plotly autoranges on the histogram bars
    // only, so a sim_df.value outside the data span rendered the marker
    // outside the visible x-range. Extend the axis to include the marker
    // with 5% padding. No canonical bucketing change — range is a
    // layout-only concern.
    const finite: number[] = [
      ...values,
      ...(convergedValues ?? []),
      ...(approximateValues ?? []),
    ].filter((v) => Number.isFinite(v))
    const dataMin = finite.length > 0 ? Math.min(...finite) : simMarkerValue
    const dataMax = finite.length > 0 ? Math.max(...finite) : simMarkerValue
    const lo = Math.min(dataMin, simMarkerValue)
    const hi = Math.max(dataMax, simMarkerValue)
    const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.05 || 0.05
    layout.xaxis = {
      ...(layout.xaxis as Record<string, unknown>),
      range: [lo - pad, hi + pad],
    }
    // The label sits above the plot area (`yref: 'paper'`, y = 1), so the top
    // margin has to hold it.
    layout.margin = { l: 50, r: 20, t: 36, b: 40 }
    const markerColour = series(SERIES_SIM_MARKER)
    layout.shapes = [
      {
        type: 'line',
        x0: simMarkerValue,
        x1: simMarkerValue,
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: { color: markerColour, width: 1.5, dash: 'dash' },
      },
    ]
    layout.annotations = [
      {
        x: simMarkerValue,
        y: 1,
        yref: 'paper',
        yanchor: 'bottom',
        showarrow: false,
        text: `Sim Df: ${simMarkerValue.toFixed(2)}`,
        font: { size: 11, color: markerColour },
        hovertext:
          targetDf != null
            ? `Sim Df: ${simMarkerValue.toFixed(2)} (target: ${targetDf.toFixed(2)})`
            : `Sim Df: ${simMarkerValue.toFixed(2)}`,
        // `hoverinfo` exists at runtime but is missing from @types/plotly.js
        // Annotations; the layout is a plain record here, so it needs no cast.
        hoverinfo: 'text',
      },
    ]
  }

  // SAFETY: `chart-theme.layout()` and the additions above are a plain record,
  // not Plotly's own `Layout`, whose surface is far larger than this panel
  // uses. Grid, ink and hover colours are already in it; the two axis titles,
  // the marker shape and the marker annotation are ours.
  const plotLayout = layout as unknown as NonNullable<PlotParams['layout']>

  return (
    // R7: the control lives in the panel header and the table takes the chart's
    // place, one row per bucket and one column per series, so nothing moves
    // except the thing being inspected.
    <ShowValues
      columns={columns}
      rows={rows}
      caption={`The ${rows.length} buckets this chart draws, and how many values fall in each.`}
      maxHeight={260}
    >
      {({ toggle, table }) => (
        <Panel
          title={spec.label}
          hint={label}
          action={
            markerToggle ? (
              <div className="flex flex-wrap items-center gap-3">
                {markerToggle}
                {toggle}
              </div>
            ) : (
              toggle
            )
          }
        >
          <div data-testid={`distribution-${spec.key}`}>
            {table ?? (
              <Plot
                data={data}
                layout={plotLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            )}
            {stats.mean != null && (
              // The separators are real spaces, not gaps alone: this line
              // survives a copy, and `m e a n 1.80` is not the same sentence.
              <p
                className="m-0 mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-ink-muted"
                data-testid={`distribution-${spec.key}-stats`}
              >
                <span>mean</span>{' '}
                <Num value={stats.mean} digits={2} size="sm" />{' '}
                <span>±</span>{' '}
                <Num value={stats.std ?? 0} digits={2} size="sm" />{' '}
                <span>· median</span>{' '}
                <Num value={stats.median} digits={2} size="sm" />{' '}
                <span>· min</span>{' '}
                <Num value={stats.min} digits={2} size="sm" />{' '}
                <span>· max</span>{' '}
                <Num value={stats.max} digits={2} size="sm" />
              </p>
            )}
            {/* Mean dual-display (T5.5): inclusive mean when it differs */}
            {spec.key === 'df' &&
              batchStats?.mean_df_inclusive != null &&
              batchStats?.mean_df != null &&
              batchStats.mean_df_inclusive !== batchStats.mean_df && (
                <p
                  className="m-0 mt-1 flex items-baseline gap-1 text-[11px] text-ink-faint"
                  data-testid={`distribution-${spec.key}-inclusive`}
                >
                  <span>(inclusive:</span>{' '}
                  <Num value={batchStats.mean_df_inclusive} digits={2} size="sm" />
                  <span>)</span>
                </p>
              )}
            {/* Quality count subtitle (T5.6): overall breakdown for Df */}
            {spec.key === 'df' && batchStats?.n_converged != null && (
              <p
                className="m-0 mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-ink-faint"
                data-testid={`distribution-${spec.key}-quality-counts`}
              >
                <Num value={batchStats.n_converged} digits={0} size="sm" />{' '}
                <span>converged</span>
                {(batchStats.n_approximate ?? 0) > 0 && (
                  <>
                    {' '}
                    <span>·</span>{' '}
                    <Num value={batchStats.n_approximate} digits={0} size="sm" />{' '}
                    <span>approximate</span>
                  </>
                )}
              </p>
            )}
          </div>
        </Panel>
      )}
    </ShowValues>
  )
}

export default FraktalBatchDistributions
