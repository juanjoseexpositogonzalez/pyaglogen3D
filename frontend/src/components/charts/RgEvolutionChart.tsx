'use client'

/**
 * RgEvolutionChart — supports two prop shapes:
 *
 *   1. Single-series (existing): `{ rgEvolution, parameters }` — used by
 *      the single-sim detail page. Behavior unchanged byte-for-byte from
 *      the pre-T15 implementation so no regression.
 *
 *   2. Multi-series (T15): `{ series: RgSeries[] }` — used by the
 *      Compare page. Each series carries its own `rgEvolution`, its own
 *      `parameters` (for the nm scale factor), a display label, and a
 *      color. Series whose `rgEvolution` is empty are omitted from the
 *      plot and listed under the chart as "no evolution data available".
 *
 * Prop discrimination
 * -------------------
 * We use presence of the `series` key as the discriminator:
 *
 *     'series' in props  →  multi-series path
 *     otherwise          →  single-series path (legacy)
 *
 * This keeps every existing call site working without edits.
 */
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { PlotParams } from 'react-plotly.js'

import { getScaleFactorNm } from '@/lib/units'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

// ---------------------------------------------------------------------------
// Single-series prop shape (legacy).
// ---------------------------------------------------------------------------
interface RgEvolutionChartSingleProps {
  rgEvolution: number[]
  /**
   * Simulation parameters, used to resolve the nm scale factor via the shim.
   * When omitted the default scale (DEFAULT_DIAMETER_NM / 2 = 25 nm) is used.
   */
  parameters?: Record<string, unknown>
  className?: string
}

// ---------------------------------------------------------------------------
// Multi-series prop shape (T15, Compare page).
// ---------------------------------------------------------------------------
export interface RgSeries {
  /** Display name in the legend. */
  label: string
  /** Line + marker color. */
  color: string
  /** Engine-unit Rg evolution array (chart does nm scaling). */
  rgEvolution: number[]
  /** Per-series params for the nm scale factor. */
  parameters?: Record<string, unknown>
}

interface RgEvolutionChartMultiProps {
  series: RgSeries[]
  className?: string
}

export type RgEvolutionChartProps =
  | RgEvolutionChartSingleProps
  | RgEvolutionChartMultiProps

function isMultiSeries(
  props: RgEvolutionChartProps,
): props is RgEvolutionChartMultiProps {
  return 'series' in props && Array.isArray(props.series)
}

const BASE_LAYOUT: PlotParams['layout'] = {
  title: {
    text: 'Radius of Gyration Evolution',
    font: { size: 14, color: '#e2e8f0' },
  },
  xaxis: {
    title: { text: 'log10(N)', font: { color: '#e2e8f0' } },
    gridcolor: '#334155',
    zerolinecolor: '#475569',
    color: '#e2e8f0',
  },
  yaxis: {
    title: { text: 'log10(Rg/nm)', font: { color: '#e2e8f0' } },
    gridcolor: '#334155',
    zerolinecolor: '#475569',
    color: '#e2e8f0',
  },
  paper_bgcolor: '#1e293b',
  plot_bgcolor: '#0f172a',
  font: { color: '#e2e8f0' },
  margin: { t: 50, r: 30, b: 50, l: 60 },
  showlegend: false,
}

// ---------------------------------------------------------------------------
// Single-series implementation (unchanged behavior).
// ---------------------------------------------------------------------------
function SingleSeriesChart({
  rgEvolution,
  parameters,
  className,
}: RgEvolutionChartSingleProps) {
  const { xData, yData } = useMemo(() => {
    if (rgEvolution.length === 0) {
      return { xData: [] as number[], yData: [] as number[] }
    }
    const scale = getScaleFactorNm(parameters)
    const n = rgEvolution.map((_, i) => i + 1)
    return {
      xData: n.map((v) => Math.log10(v)),
      yData: rgEvolution.map((v) => Math.log10(v * scale)),
    }
  }, [rgEvolution, parameters])

  if (rgEvolution.length === 0) {
    return (
      <div className={className}>
        <p className="text-muted-foreground text-center py-8">
          No evolution data available
        </p>
      </div>
    )
  }

  const plotData: PlotParams['data'] = [
    {
      x: xData,
      y: yData,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'Rg vs N',
      marker: { color: '#4488ff', size: 4 },
      line: { color: '#4488ff', width: 2 },
    },
  ]

  return (
    <div className={className}>
      <Plot
        data={plotData}
        layout={BASE_LAYOUT}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%', height: '300px' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-series implementation (T15).
// ---------------------------------------------------------------------------
function MultiSeriesChart({ series, className }: RgEvolutionChartMultiProps) {
  const { traces, missingLabels } = useMemo(() => {
    const out: PlotParams['data'] = []
    const missing: string[] = []

    for (const s of series) {
      if (!s.rgEvolution || s.rgEvolution.length === 0) {
        missing.push(s.label)
        continue
      }
      const scale = getScaleFactorNm(s.parameters)
      const n = s.rgEvolution.map((_, i) => i + 1)
      out.push({
        x: n.map((v) => Math.log10(v)),
        y: s.rgEvolution.map((v) => Math.log10(v * scale)),
        mode: 'lines+markers',
        type: 'scatter',
        name: s.label,
        marker: { color: s.color, size: 4 },
        line: { color: s.color, width: 2 },
      })
    }

    return { traces: out, missingLabels: missing }
  }, [series])

  // Empty state: every series was missing (or series[] itself empty).
  if (traces.length === 0) {
    return (
      <div className={className} data-testid="rg-chart-empty">
        <p className="text-muted-foreground text-center py-8">
          No evolution data available
        </p>
        {missingLabels.length > 0 && (
          <ul
            data-testid="rg-chart-missing-list"
            className="mt-2 space-y-0.5 text-center text-xs text-muted-foreground"
          >
            {missingLabels.map((label) => (
              <li key={label}>{label}: no evolution data available</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const layout: PlotParams['layout'] = {
    ...BASE_LAYOUT,
    showlegend: true,
  }

  return (
    <div className={className} data-testid="rg-chart-multi">
      <Plot
        data={traces}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%', height: '300px' }}
      />
      {missingLabels.length > 0 && (
        <ul
          data-testid="rg-chart-missing-list"
          className="mt-2 space-y-0.5 text-xs text-muted-foreground"
        >
          {missingLabels.map((label) => (
            <li key={label}>{label}: no evolution data available</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public entry point — dispatches on prop shape.
// ---------------------------------------------------------------------------
export function RgEvolutionChart(props: RgEvolutionChartProps) {
  if (isMultiSeries(props)) {
    return <MultiSeriesChart {...props} />
  }
  return <SingleSeriesChart {...props} />
}
