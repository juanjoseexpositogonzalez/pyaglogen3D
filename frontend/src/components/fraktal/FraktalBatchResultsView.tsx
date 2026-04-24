'use client'

/**
 * FraktalBatchResultsView — full result display for a completed batch
 * FRAKTAL analysis (T4.3, change: fraktal-batch-analysis). Renders:
 *
 *   1. A batch-level statistics card (mean/std/median/Q1/Q3/min/max Df)
 *      + a calibration summary (source, px/100nm, dpo).
 *   2. A Df distribution histogram when the batch produced one (≥5
 *      successful images — R7).
 *   3. A per-image results table with client-side sorting (R9).
 *   4. Optional Sorensen comparison card when the batch was linked to a
 *      simulation (R11 via FraktalComparisonCard).
 *
 * Everything is computed from the `FraktalBatchResult` produced by
 * `fraktalApi.analyzeBatch`; no additional API calls happen here.
 */
import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDown, ArrowUp, BarChart3, Table as TableIcon } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FraktalComparisonCard } from './FraktalComparisonCard'
import type { FraktalBatchResult } from '@/lib/api'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface Props {
  result: FraktalBatchResult
}

type SortKey =
  | 'index'
  | 'filename'
  | 'azimuth'
  | 'elevation'
  | 'fractal_dimension'
  | 'prefactor'
  | 'r_squared'
  | 'n_particles_counted'

type SortDir = 'asc' | 'desc'

export function FraktalBatchResultsView({ result }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const sortedImages = useMemo(() => {
    const images = [...result.images]
    images.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // null last in asc, null first in desc (consistent stable ordering).
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

  const sortIcon = (key: SortKey) => {
    if (key !== sortKey) return null
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 inline ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 inline ml-1" />
    )
  }

  const fmt = (v: number | null | undefined, digits = 3) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)

  const hasAnyError = sortedImages.some((img) => img.error)

  return (
    <div className="space-y-4">
      {/* Stats summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Batch Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat
              label="Images"
              value={`${result.stats.n_successful} / ${result.stats.n_images}`}
            />
            <Stat label="Mean Df" value={fmt(result.stats.mean_df)} />
            <Stat label="Std Df" value={fmt(result.stats.std_df)} />
            <Stat label="Median Df" value={fmt(result.stats.median_df)} />
            <Stat label="Q1 Df" value={fmt(result.stats.q1_df)} />
            <Stat label="Q3 Df" value={fmt(result.stats.q3_df)} />
            <Stat label="Min Df" value={fmt(result.stats.min_df)} />
            <Stat label="Max Df" value={fmt(result.stats.max_df)} />
          </div>
          <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
            <span className="font-medium">Calibration:</span>{' '}
            {result.calibration.source} —{' '}
            {result.calibration.pixels_per_100nm.toFixed(1)} px/100nm, dpo ={' '}
            {result.calibration.dpo_used.toFixed(2)} nm
            {result.calibration.autocalibrate_image !== null && (
              <span>
                {' '}
                (autocalibrated on image {result.calibration.autocalibrate_image})
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Histogram — only shown when backend produced one (≥5 successful, R7) */}
      {result.histogram && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4" />
              Df Distribution ({result.histogram.rule_used})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Plot
              data={[
                {
                  type: 'bar',
                  x: result.histogram.bin_edges
                    .slice(0, -1)
                    .map(
                      (e, i) => (e + result.histogram!.bin_edges[i + 1]) / 2
                    ),
                  y: result.histogram.counts,
                  marker: { color: '#2563eb' },
                  hovertemplate:
                    'Df: %{x:.3f}<br>Count: %{y}<extra></extra>',
                },
              ]}
              layout={{
                autosize: true,
                height: 280,
                margin: { l: 40, r: 20, t: 20, b: 40 },
                xaxis: { title: { text: 'Fractal Dimension' } },
                yaxis: { title: { text: 'Count' } },
                plot_bgcolor: 'transparent',
                paper_bgcolor: 'transparent',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
              useResizeHandler
            />
          </CardContent>
        </Card>
      )}

      {!result.histogram && result.stats.n_successful < 5 && (
        <Alert>
          <AlertDescription>
            Histogram not shown (fewer than 5 successful images).
          </AlertDescription>
        </Alert>
      )}

      {/* Comparison card (R11) — present only when the batch was linked to a sim */}
      {result.comparison && <FraktalComparisonCard comparison={result.comparison} />}

      {/* Per-image table (R9) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <TableIcon className="h-4 w-4" />
            Per-image Results
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <Th onClick={() => handleSort('index')}>
                    #{sortIcon('index')}
                  </Th>
                  <Th onClick={() => handleSort('filename')}>
                    Filename{sortIcon('filename')}
                  </Th>
                  <Th onClick={() => handleSort('azimuth')}>
                    Az{sortIcon('azimuth')}
                  </Th>
                  <Th onClick={() => handleSort('elevation')}>
                    El{sortIcon('elevation')}
                  </Th>
                  <Th onClick={() => handleSort('fractal_dimension')}>
                    Df{sortIcon('fractal_dimension')}
                  </Th>
                  <Th onClick={() => handleSort('prefactor')}>
                    kf{sortIcon('prefactor')}
                  </Th>
                  <Th onClick={() => handleSort('r_squared')}>
                    R²{sortIcon('r_squared')}
                  </Th>
                  <Th onClick={() => handleSort('n_particles_counted')}>
                    N{sortIcon('n_particles_counted')}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {sortedImages.map((img) => (
                  <tr
                    key={img.index}
                    className="border-b hover:bg-muted/50"
                    title={img.error ?? undefined}
                  >
                    <td className="p-2 font-mono">{img.index}</td>
                    <td
                      className="p-2 truncate max-w-[220px]"
                      title={img.filename ?? ''}
                    >
                      {img.filename ?? '—'}
                    </td>
                    <td className="p-2 font-mono">{fmt(img.azimuth, 1)}</td>
                    <td className="p-2 font-mono">{fmt(img.elevation, 1)}</td>
                    <td className="p-2 font-mono">
                      {fmt(img.fractal_dimension)}
                    </td>
                    <td className="p-2 font-mono">{fmt(img.prefactor)}</td>
                    <td className="p-2 font-mono">{fmt(img.r_squared)}</td>
                    <td className="p-2 font-mono">
                      {img.n_particles_counted ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasAnyError && (
            <Alert className="mt-3">
              <AlertDescription>
                Some images failed to analyze. Hover a row for error details.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  )
}

function Th({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <th
      className="text-left p-2 font-medium cursor-pointer hover:bg-muted/50 select-none"
      onClick={onClick}
    >
      {children}
    </th>
  )
}
