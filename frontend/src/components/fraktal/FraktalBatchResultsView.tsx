'use client'

/**
 * FraktalBatchResultsView — full result display for a completed batch FRAKTAL
 * analysis (change: fraktal-drilldown-and-csv; re-skinned on the design-system
 * kit by issue #176, slice 3B).
 *
 * What it shows is unchanged: the batch-level statistics (mean/std/median/Q1/
 * Q3/min/max Df plus the calibration summary), the Df histogram when the
 * backend produced one (≥5 successful images — R7), the per-image table with
 * client-side sorting whose rows open the drill-down route (T6.1), the R12
 * study comparison card when the batch was linked to a simulation (R11 via
 * BatchStudyComparisonCard), the Download CSV (T6.2) and Delete batch (T6.3)
 * actions, and the bulk re-analysis of the failed images (R13).
 *
 * What changed is who owns the presentation: every surface is a `Panel`, the
 * per-image table is a `DataTable`, the two headline statistics are
 * `MetricCard`s, every reading goes through `Num`, and each state that used to
 * be a coloured card or an `Alert` is a `Callout` whose tone never carries the
 * meaning alone.
 *
 * Three presentation decisions came with it, declared here rather than left to
 * review:
 *
 * 1. The mean Df now carries the batch's own standard deviation as its sigma
 *    (`±0.050`) instead of standing beside a flat "Std Df" cell. A dimension
 *    without its dispersion is a number without a claim, which is what
 *    `MetricCard` exists to prevent; the spread statistics stay listed under
 *    the cards, so nothing was dropped.
 * 2. The ratio of successful images keeps a single text node (`3 / 3`). It is
 *    a fraction of two counts, not a reading with a unit: `Num` prints one
 *    quantity and would split the pair across two elements. It borrows the
 *    `.num` type treatment the way the comparison table's signed delta does.
 * 3. The quality cell renders the kit's `QualityBadge`, whose label for
 *    `failed` is "Unusable". Both unions contain `failed` and in a FRAKTAL row
 *    the badge and a status chip can sit side by side, so the kit deliberately
 *    does not say "Failed" twice for different things.
 *
 * Sorting moved from a click on the `<th>` to a named control inside it: a
 * header cell is not focusable and carries no role, so the only way to sort
 * was with a mouse. The `button` says the column and the direction it will
 * apply, and the row order it produces is the same order as before.
 *
 * What a review asked for, and what the screen now does:
 *
 * 1. The Df histogram is wrapped in `ShowValues` (R7 of
 *    `design-system-foundation`): the control sits in the panel header and the
 *    table of bins takes the chart's place. The rows are the backend's own
 *    `bin_edges` and `counts`, so the table cannot drift from the bars.
 * 2. The quality chip's reason is the state's meaning (`QUALITY_REASONS`), not
 *    `img.error`: an `approximate` image has no error, and the chip used to
 *    announce "no failure reason recorded" over a state whose reason is known.
 *    The engine's own message, where there is one, stays in the row's hover
 *    title.
 * 3. The summary's readings are `DetailList`, the kit's own label/value list,
 *    instead of a private copy of it in this file.
 * 4. The per-image table has a caption, and therefore an accessible name: the
 *    page renders more than one table, and `DataTable` takes the name from the
 *    caption alone, so the three were distinguishable only by position.
 *
 * Two copy changes are declared rather than passed over, because both are
 * visible and neither is a rename of the same words:
 *
 * - The delete confirmation now reads `Delete this batch?` / "This action
 *   cannot be undone: the images and their analyses are removed with the
 *   batch." The old body was "Are you sure you want to delete this batch? This
 *   action cannot be undone." The destructive button and its `aria-label` are
 *   unchanged.
 * - The histogram is announced with the backend's bucketing rule and the bins
 *   it returned; the notice shown instead of it keeps its original sentence
 *   ("Histogram not shown (fewer than 5 successful images)") as the callout's
 *   title so no reader loses the phrase they were used to.
 */
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { PlotParams } from 'react-plotly.js'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  Download,
  RefreshCw,
  Table as TableIcon,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { BatchStudyComparisonCard } from './BatchStudyComparisonCard'
import { Callout } from '@/components/kit/Callout'
import { DataTable, type Column } from '@/components/kit/DataTable'
import { DetailList, type DetailItem } from '@/components/kit/DetailList'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'
import { QualityBadge } from '@/components/kit/QualityBadge'
import { ShowValues } from '@/components/kit/ShowValues'
import { layout as chartLayout, series } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/useThemeStore'
import {
  fraktalApi,
  type AnalysisQuality,
  type FraktalBatchHistogram,
  type FraktalBatchImageResult,
  type FraktalBatchResult,
} from '@/lib/api'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface Props {
  result: FraktalBatchResult
  projectId: string
  batchId: string
  /** Called after a successful delete so the parent can redirect / reset. */
  onDeleted?: () => void
  /** Called with the refreshed payload after a bulk failed-image
   *  re-analysis completes so the parent can update its state. */
  onResultUpdate?: (result: FraktalBatchResult) => void
}

type SortKey =
  | 'index'
  | 'filename'
  | 'azimuth'
  | 'elevation'
  | 'fractal_dimension'
  | 'quality'
  | 'prefactor'
  | 'rg_nm'
  | 'r_squared'
  | 'n_particles_counted'

type SortDir = 'asc' | 'desc'

/**
 * The batch's counts, as one fraction. A ratio of two counts is not a reading
 * with a unit, so it stays a single text node and borrows `.num`'s tabular
 * treatment rather than being split across two `Num`s.
 */
function Ratio({ successful, total }: { successful: number; total: number }) {
  return <span className="num text-[13px] text-ink">{`${successful} / ${total}`}</span>
}

/**
 * What each quality state means, for the chip's spoken reason.
 *
 * The reason cannot be `img.error`: an `approximate` image has no error, and a
 * chip that announces "no failure reason recorded" over a state whose reason is
 * known — it is the *state* — tells a screen-reader user something false. The
 * engine's own message, when there is one, stays in the row's hover title.
 */
const QUALITY_REASONS: Record<AnalysisQuality, string> = {
  converged: 'The fit converged on a sign change.',
  approximate:
    'The bisection settled between bounds instead of finding a sign change, so the dimension is less certain than a converged one.',
  excluded:
    'Outside the model domain, or too noisy to threshold, so it is excluded from the batch statistics.',
  failed: 'The engine produced no usable dimension for this image.',
}

export function FraktalBatchResultsView({
  result,
  projectId,
  batchId,
  onDeleted,
  onResultUpdate,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeProgress, setReanalyzeProgress] = useState<number | null>(null)

  // Repaint the plot with the ramp in force after a theme flip.
  useThemeStore((state) => state.resolved)

  const sortedImages = useMemo(() => {
    const images = [...result.images]
    images.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null && bv === null) return 0
      if (av === null) return sortDir === 'asc' ? 1 : -1
      if (bv === null) return sortDir === 'asc' ? -1 : 1
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc'
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number)
    })
    return images
  }, [result.images, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const hasAnyError = sortedImages.some((img) => img.error)

  const handleDownloadCsv = useCallback(async () => {
    try {
      const blob = await fraktalApi.downloadBatchCsv(projectId, batchId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fraktal-batch-${batchId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('CSV download failed:', err)
    }
  }, [projectId, batchId])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await fraktalApi.deleteBatch(projectId, batchId)
      onDeleted?.()
    } catch (err) {
      console.error('Batch delete failed:', err)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }, [projectId, batchId, onDeleted])

  // R13 (fraktal-batch-extensions): bulk re-analysis of the failed images,
  // in place on the backend. <=30 failed -> sync 200; >30 -> 202 + polling
  // (progress reported via onProgress ticks). Zero failed is guarded by
  // rendering the button only when n_failed > 0.
  const nFailed = result.stats.n_failed ?? 0

  const handleReanalyzeFailed = useCallback(async () => {
    setReanalyzing(true)
    setReanalyzeProgress(null)
    try {
      const updated = await fraktalApi.reanalyzeFailedBatch(
        projectId,
        batchId,
        (p) => setReanalyzeProgress(p.progress)
      )
      onResultUpdate?.(updated)
    } catch (err) {
      console.error('Bulk re-analysis failed:', err)
    } finally {
      setReanalyzing(false)
      setReanalyzeProgress(null)
    }
  }, [projectId, batchId, onResultUpdate])

  /** A sortable column header: the control names the column and the direction. */
  const sortHeader = (key: SortKey, label: string) => {
    const active = key === sortKey
    const nextDir = active && sortDir === 'asc' ? 'descending' : active ? 'ascending' : 'ascending'
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1 text-left text-[10px] uppercase tracking-[0.05em] text-ink-muted hover:text-ink"
        aria-label={`Sort by ${label}, ${nextDir}`}
      >
        {label}
        {active &&
          (sortDir === 'asc' ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ))}
      </button>
    )
  }

  const cellHref = (img: FraktalBatchImageResult) =>
    `/projects/${projectId}/fraktal/batch/${batchId}/image/${img.index}`

  /**
   * A cell that opens the drill-down for its row. The row is not a link — a
   * table row is not focusable and cannot be one — so every cell carries the
   * same target, which keeps "click anywhere on the row" working and keeps the
   * hover title, where the failure reason lives, on the thing being hovered.
   */
  const cell = (img: FraktalBatchImageResult, content: ReactNode) => (
    <Link href={cellHref(img)} className="block" title={img.error ?? undefined}>
      {content}
    </Link>
  )

  const columns: Column<FraktalBatchImageResult>[] = [
    {
      key: 'index',
      header: sortHeader('index', '#'),
      render: (img) => cell(img, <span className="num">{img.index}</span>),
    },
    {
      key: 'filename',
      header: sortHeader('filename', 'Filename'),
      render: (img) => cell(img, <span>{img.filename ?? '—'}</span>),
    },
    {
      key: 'azimuth',
      header: sortHeader('azimuth', 'Az'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.azimuth} digits={1} size="sm" />),
    },
    {
      key: 'elevation',
      header: sortHeader('elevation', 'El'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.elevation} digits={1} size="sm" />),
    },
    {
      key: 'fractal_dimension',
      header: sortHeader('fractal_dimension', 'Df'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.fractal_dimension} digits={3} size="sm" />),
    },
    {
      key: 'quality',
      header: sortHeader('quality', 'Quality'),
      render: (img) =>
        cell(
          img,
          img.quality ? (
            img.quality === 'converged' ? (
              <QualityBadge quality="converged" />
            ) : (
              <QualityBadge quality={img.quality} reason={QUALITY_REASONS[img.quality]} />
            )
          ) : (
            <span>—</span>
          ),
        ),
    },
    {
      key: 'prefactor',
      header: sortHeader('prefactor', 'kf'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.prefactor} digits={3} size="sm" />),
    },
    {
      key: 'rg_nm',
      header: sortHeader('rg_nm', 'Rg (nm)'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.rg_nm} digits={1} size="sm" />),
    },
    {
      key: 'r_squared',
      header: sortHeader('r_squared', 'R²'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.r_squared} digits={3} size="sm" />),
    },
    {
      key: 'n_particles_counted',
      header: sortHeader('n_particles_counted', 'N'),
      numeric: true,
      render: (img) => cell(img, <Num value={img.n_particles_counted} digits={0} size="sm" />),
    },
  ]

  return (
    <div className="grid gap-4">
      {/* Batch-level actions. Destructive and long-running operations sit here,
          away from the readings they act on. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadCsv}
          aria-label="Download CSV"
        >
          <Download className="h-4 w-4 mr-2" />
          Download CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          aria-label="Delete batch"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete batch
        </Button>
        {nFailed > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReanalyzeFailed}
            disabled={reanalyzing}
            aria-label="Re-analyze failed images"
            data-testid="reanalyze-failed-button"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${reanalyzing ? 'animate-spin' : ''}`}
            />
            {reanalyzing
              ? reanalyzeProgress != null
                ? `Re-analyzing (${Math.round(reanalyzeProgress * 100)}%)`
                : 'Re-analyzing...'
              : `Re-analyze failed (${nFailed})`}
          </Button>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <Callout
          tone="danger"
          title="Delete this batch?"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Confirm delete"
              >
                {deleting ? 'Deleting...' : 'Confirm delete'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          }
        >
          This action cannot be undone: the images and their analyses are removed with the
          batch.
        </Callout>
      )}

      {/* Stats summary */}
      <Panel
        title="Batch Summary"
        hint="The aggregate statistics of the images the engine could measure, and the calibration it measured them against."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            kind="measured"
            label="Mean Df"
            value={result.stats.mean_df}
            digits={3}
            sigma={result.stats.std_df}
            detail="mean of the per-image dimensions the engine measured"
          />
          <MetricCard
            kind="measured"
            label="Median Df"
            value={result.stats.median_df}
            digits={3}
            sigma={null}
            detail="the middle dimension of the batch — immune to one mis-fitted image"
          />
        </div>

        <DetailList
          className="mt-4"
          items={[
            {
              label: 'Images',
              value: (
                <Ratio
                  successful={result.stats.n_successful}
                  total={result.stats.n_images}
                />
              ),
            },
            { label: 'Std Df', value: result.stats.std_df, digits: 3 },
            { label: 'Q1 Df', value: result.stats.q1_df, digits: 3 },
            { label: 'Q3 Df', value: result.stats.q3_df, digits: 3 },
            { label: 'Min Df', value: result.stats.min_df, digits: 3 },
            { label: 'Max Df', value: result.stats.max_df, digits: 3 },
          ] satisfies DetailItem[]}
        />

        <p className="m-0 mt-4 border-t border-line pt-3 text-[11px] text-ink-muted">
          <span className="font-bold text-ink">Calibration:</span>{' '}
          {result.calibration.source} —{' '}
          <Num
            value={result.calibration.pixels_per_100nm}
            digits={1}
            unit="px/100nm"
            size="sm"
          />
          , dpo = <Num value={result.calibration.dpo_used} digits={2} unit="nm" size="sm" />
          {result.calibration.autocalibrate_image !== null && (
            <span>
              {' '}
              (autocalibrated on image {result.calibration.autocalibrate_image})
            </span>
          )}
        </p>
      </Panel>

      {/* Histogram — only shown when backend produced one (≥5 successful, R7).
          The panel is built by `HistogramPanel` so the values toggle can sit in
          its header: `ShowValues` hands back the control and the table. */}
      {result.histogram && <HistogramPanel histogram={result.histogram} />}

      {!result.histogram && result.stats.n_successful < 5 && (
        <Callout tone="info" title="Histogram not shown (fewer than 5 successful images)">
          A distribution of four readings or fewer says nothing about the batch, so the
          backend does not compute one.
        </Callout>
      )}

      {/* Study comparison card (R12) — REPLACES the legacy comparison card
          at this shared swap point (R12.3): exactly one card and one R11
          Sorensen note per page. Renders ONLY when study_comparison is
          non-null; the null branch shows NO card and NO legacy fallback
          (the sentinel rule would be reintroduced). */}
      {result.study_comparison ? (
        <BatchStudyComparisonCard studyComparison={result.study_comparison} />
      ) : null}

      {/* Per-image table (R9) — rows open the drill-down (T6.1) */}
      <Panel
        title="Per-image Results"
        hint="Every image the batch carried. Sorting is client-side; a row opens that image's own page."
        action={
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <TableIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {sortedImages.length} rows
          </span>
        }
      >
        <DataTable
          columns={columns}
          rows={sortedImages}
          rowKey={(row) => String(row.index)}
          // `DataTable` takes its accessible name from the caption, and this
          // page shows more than one table: a position is not a name.
          caption="Every image the batch carried: index, file, angles, dimension, quality, prefactor, radius of gyration, fit quality and particle count."
          emptyMessage="The batch returned no images."
        />
        {hasAnyError && (
          <Callout tone="warning" title="Some images failed to analyze" className="mt-3">
            Hover a row for error details.
          </Callout>
        )}
      </Panel>
    </div>
  )
}

/** One row of the table behind the histogram: a bin the backend returned. */
interface HistogramBinRow {
  from: number | null
  to: number | null
  count: number | null
}

/** The columns of that table: the edges, and the count in the bin. */
const HISTOGRAM_COLUMNS: Column<HistogramBinRow>[] = [
  { key: 'from', header: 'From', numeric: true, digits: 3, value: (row) => row.from },
  { key: 'to', header: 'To', numeric: true, digits: 3, value: (row) => row.to },
  { key: 'count', header: 'Count', numeric: true, digits: 0, value: (row) => row.count },
]

/**
 * The Df histogram, its values table, and the panel that frames both.
 *
 * The bars take their colour from the kit's series ramp rather than Tailwind's
 * palette, and the layout comes from `chart-theme`, so the grid, the ink and
 * the hover label follow the active theme instead of being painted once for
 * light paper and left there.
 *
 * R7 of `design-system-foundation` binds here the moment the panel adopted the
 * kit: the table carries the bins the backend returned — the same `bin_edges`
 * and `counts` the bars are drawn from — so the reader can have the numbers
 * without re-deriving them from the picture.
 */
function HistogramPanel({ histogram }: { histogram: FraktalBatchHistogram }) {
  const rows: HistogramBinRow[] = histogram.bin_edges.slice(0, -1).map((from, i) => ({
    from,
    to: histogram.bin_edges[i + 1],
    count: histogram.counts[i],
  }))

  return (
    <ShowValues
      columns={HISTOGRAM_COLUMNS}
      rows={rows}
      caption={`The ${rows.length} bins behind the histogram, with the count in each.`}
      maxHeight={300}
    >
      {({ toggle, table }) => (
        <Panel
          title={`Df Distribution (${histogram.rule_used})`}
          hint="How the batch's dimensions are spread. The bucketing rule is the backend's; this view plots the bins it returns."
          action={toggle}
        >
          {table ?? <HistogramChart histogram={histogram} />}
        </Panel>
      )}
    </ShowValues>
  )
}

/** The bars. Kept apart from the panel so the table can take its place. */
function HistogramChart({ histogram }: { histogram: FraktalBatchHistogram }) {
  const base = chartLayout()
  const xaxis = base.xaxis as Record<string, unknown>
  const yaxis = base.yaxis as Record<string, unknown>

  return (
    <Plot
      data={[
        {
          type: 'bar',
          x: histogram.bin_edges
            .slice(0, -1)
            .map((edge, i) => (edge + histogram.bin_edges[i + 1]) / 2),
          y: histogram.counts,
          marker: { color: series(0) },
          hovertemplate: 'Df: %{x:.3f}<br>Count: %{y}<extra></extra>',
        },
      ]}
      layout={
        // SAFETY: `chart-theme.layout()` returns a plain record, not Plotly's
        // own `Layout`, whose type covers a surface far larger than this
        // chart uses. Grid, ink and hover colours are already in place; only
        // the height and the two axis titles are ours.
        {
          ...base,
          height: 280,
          xaxis: { ...xaxis, title: { text: 'Fractal Dimension' } },
          yaxis: { ...yaxis, title: { text: 'Count' } },
        } as unknown as NonNullable<PlotParams['layout']>
      }
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}

export default FraktalBatchResultsView
