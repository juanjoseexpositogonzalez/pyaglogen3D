'use client'

/**
 * FractalAnalysisTab — dedicated "Fractal Analysis" study tab (spec R7 of
 * change batch-windowed-box-counting; design D7, persona-locked P3).
 *
 * Contents:
 *  (a) Per-sim comparison table: sim, config, Rg Df, BC Df, BC R² and — when
 *      the study has a windowed run — BC Win Df, BC Win R², Δ (bc_delta) and
 *      the windowed status (`insufficient_levels`/`error` rendered
 *      distinctly). Without a windowed run the table keeps the legacy + Rg
 *      columns only and shows NO error state (R7.1).
 *  (b) Per-config per-estimator histogram panels. Raw `values` arrays come
 *      from GET .../fractal-analysis/ (R5); bucketing is computed CLIENT-side
 *      with `sturgesBuckets` (clamp [3,30]) reused from
 *      FraktalBatchDistributions. Data-volume behaviors inherited from
 *      fraktal-batch-distributions (R7.2 / M3): n=0 → "No data available";
 *      1≤n<5 → "Not enough data"; n≥5 → histogram, with zero-variance input
 *      collapsing into a single bar.
 *  (c) CSV export button delegating to the existing study CSV endpoint — the
 *      BC_Win_* columns are appended server-side per R6 (header gate at
 *      study level) when the study has a windowed run.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'

import { studiesApi } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { sturgesBuckets } from '@/components/fraktal/FraktalBatchDistributions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type {
  ParametricStudyResult,
  ParametricStudyResults,
  StudyEstimatorStats,
  WindowedBlock,
  WindowedBlockStatus,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FractalAnalysisTabProps {
  projectId: string
  studyId: string
  /** Study results (R4 rows carry `box_counting_windowed` + `bc_delta`). */
  results: ParametricStudyResults
  /** Delegates to the existing study CSV export handler (R6). */
  onExportCsv: () => void | Promise<void>
  isExporting?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Same per-metric gate as FraktalBatchDistributions (MIN_N_SUCCESSFUL). */
const MIN_N_SUCCESSFUL = 5

type EstimatorKey = 'rg' | 'bc_legacy' | 'bc_windowed'

const ESTIMATORS: Array<{ key: EstimatorKey; label: string }> = [
  { key: 'rg', label: 'Rg Df' },
  { key: 'bc_legacy', label: 'BC Df' },
  { key: 'bc_windowed', label: 'BC Win Df' },
]

const WIN_STATUS_META: Record<
  WindowedBlockStatus,
  { label: string; className: string }
> = {
  ok: {
    label: 'ok',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  insufficient_levels: {
    label: 'insufficient levels',
    className:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  error: {
    label: 'error',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
}

/** Project the config label from the varying grid keys (falls back to all). */
function formatConfigLabel(
  result: ParametricStudyResult,
  paramKeys: string[],
): string {
  const entries: Array<[string, unknown]> = paramKeys.length
    ? paramKeys.map((k) => [k, result.parameters[k]])
    : Object.entries(result.parameters)
  return entries.map(([k, v]) => `${k}=${v}`).join(', ')
}

export interface HistogramBin {
  start: number
  end: number
  count: number
}

/**
 * Explicit client-side bucketing (R5): Sturges' rule with clamp [3, 30],
 * reusing `sturgesBuckets` from FraktalBatchDistributions. Zero-variance
 * input collapses into a single bin → single bar (R5/R7.2).
 */
export function bucketValues(values: number[]): HistogramBin[] {
  const k = sturgesBuckets(values.length)
  // Loop instead of Math.min(...values) — spread overflows the stack on
  // large arrays.
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min === max) {
    return [{ start: min, end: max, count: values.length }]
  }
  const width = (max - min) / k
  const bins: HistogramBin[] = Array.from({ length: k }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    count: 0,
  }))
  for (const v of values) {
    const idx = Math.min(k - 1, Math.floor((v - min) / width))
    bins[idx].count += 1
  }
  return bins
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FractalAnalysisTab({
  projectId,
  studyId,
  results,
  onExportCsv,
  isExporting = false,
}: FractalAnalysisTabProps) {
  const paramKeys = useMemo(
    () => Object.keys(results.parameter_grid ?? {}),
    [results.parameter_grid],
  )

  // R7.1: windowed columns only when at least one row carries a windowed block.
  const hasWindowed = useMemo(
    () => results.results.some((r) => r.box_counting_windowed != null),
    [results.results],
  )

  // Per-config distributions (R5) — raw values, bucketed client-side below.
  const {
    data: summary,
    isLoading: isLoadingSummary,
    isError: isSummaryError,
  } = useQuery({
    queryKey: ['study-fractal-analysis', projectId, studyId],
    queryFn: () => studiesApi.fractalAnalysisSummary(projectId, studyId),
    enabled: !!studyId,
  })

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Fractal Analysis</h3>
          <Button variant="outline" size="sm" onClick={onExportCsv} disabled={isExporting}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>

        {/* (a) Per-sim comparison table (R7a) */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Sim</th>
                <th className="px-3 py-2 font-medium">Config</th>
                <th className="px-3 py-2 text-right font-medium">Rg Df</th>
                <th className="px-3 py-2 text-right font-medium">BC Df</th>
                <th className="px-3 py-2 text-right font-medium">BC R²</th>
                {hasWindowed && (
                  <>
                    <th className="px-3 py-2 text-right font-medium">BC Win Df</th>
                    <th className="px-3 py-2 text-right font-medium">BC Win R²</th>
                    <th className="px-3 py-2 text-right font-medium">Δ (bc_delta)</th>
                    <th className="px-3 py-2 font-medium">BC Win Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {results.results.map((row) => (
                <ComparisonRow
                  key={row.simulation_id}
                  row={row}
                  configLabel={formatConfigLabel(row, paramKeys)}
                  hasWindowed={hasWindowed}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* (b) Per-config distributions (R7b) */}
        <div className="mt-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">
            Distributions per config
          </h4>
          {isLoadingSummary && (
            <p className="text-sm text-muted-foreground">Loading distributions…</p>
          )}
          {isSummaryError && (
            <p
              className="text-sm text-destructive"
              data-testid="fa-distributions-error"
            >
              Failed to load distributions.
            </p>
          )}
          {summary && summary.configs.length === 0 && (
            <p className="text-sm text-muted-foreground">No completed simulations.</p>
          )}
          {summary?.configs.map((cfg, configIndex) => (
            <div key={configIndex} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                {Object.entries(cfg.config)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {ESTIMATORS.map((est) => (
                  <EstimatorPanel
                    key={est.key}
                    testId={`fa-dist-${configIndex}-${est.key}`}
                    label={est.label}
                    stats={cfg.estimators[est.key]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Inner: comparison table row
// ---------------------------------------------------------------------------

function ComparisonRow({
  row,
  configLabel,
  hasWindowed,
}: {
  row: ParametricStudyResult
  configLabel: string
  hasWindowed: boolean
}) {
  const win = row.box_counting_windowed
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2 font-mono text-xs">{row.simulation_id.slice(0, 8)}</td>
      <td className="px-3 py-2 text-xs">{configLabel}</td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(row.fractal_dimension, 3)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(row.box_counting?.dimension, 3)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(row.box_counting?.r_squared, 3)}
      </td>
      {hasWindowed && (
        <>
          <td className="px-3 py-2 text-right font-mono">
            {formatNumber(win?.dimension, 3)}
          </td>
          <td className="px-3 py-2 text-right font-mono">
            {formatNumber(win?.r_squared, 3)}
          </td>
          <td className="px-3 py-2 text-right font-mono">
            {formatNumber(row.bc_delta, 3)}
          </td>
          <td className="px-3 py-2">
            {win ? (
              <span
                title={win.error_message ?? undefined}
                className={`inline-block rounded px-2 py-0.5 text-xs ${WIN_STATUS_META[win.status].className}`}
              >
                {WIN_STATUS_META[win.status].label}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Inner: one estimator histogram panel (R7b — inherited data-volume behaviors)
// ---------------------------------------------------------------------------

function EstimatorPanel({
  label,
  stats,
  testId,
}: {
  label: string
  stats: StudyEstimatorStats
  testId: string
}) {
  const n = stats.n

  // n=0 (or all refusals) → "No data available" (R4, new tab rule for n=0).
  if (n === 0) {
    return (
      <div
        className="rounded border border-dashed border-muted-foreground/40 p-4"
        data-testid={`${testId}-no-data`}
      >
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          No data available.
          {(stats.insufficient_levels > 0 || stats.errors > 0) && (
            <span>
              {' '}
              ({stats.insufficient_levels} insufficient, {stats.errors} errors)
            </span>
          )}
        </div>
      </div>
    )
  }

  // 1≤n<5 → inherited "Not enough data" panel (fraktal-batch-distributions R4,
  // MIN_N_SUCCESSFUL gate).
  if (n < MIN_N_SUCCESSFUL) {
    return (
      <div
        className="rounded border border-dashed border-muted-foreground/40 p-4"
        data-testid={`${testId}-not-enough`}
      >
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          Not enough data: only {n} value(s). Minimum is {MIN_N_SUCCESSFUL}.
        </div>
      </div>
    )
  }

  // n≥5 → histogram. Zero-variance input collapses into a single bin (R5
  // single-bar behavior), enforced by bucketValues.
  const bins = bucketValues(stats.values)
  const maxCount = Math.max(...bins.map((b) => b.count))

  return (
    <div className="rounded border bg-card p-3" data-testid={testId} data-bin-count={bins.length}>
      <div className="text-sm font-medium">
        {label} <span className="text-muted-foreground">(n={n})</span>
      </div>
      <div className="mt-2 flex h-24 items-end gap-1">
        {bins.map((bin, i) => (
          <div
            key={i}
            title={`[${formatNumber(bin.start, 3)}, ${formatNumber(bin.end, 3)}) → ${bin.count}`}
            className="flex-1 rounded-t bg-primary/70"
            style={{ height: `${(bin.count / maxCount) * 100}%` }}
          />
        ))}
      </div>
      {(stats.insufficient_levels > 0 || stats.errors > 0) && (
        <div className="mt-1 text-xs text-muted-foreground">
          {stats.insufficient_levels} insufficient · {stats.errors} errors excluded
        </div>
      )}
    </div>
  )
}

export default FractalAnalysisTab
