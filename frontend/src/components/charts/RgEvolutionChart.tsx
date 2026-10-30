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
 *
 * The theme
 * ---------
 * Every colour this plot draws with comes from `lib/chart-theme.ts`, which
 * reads the tokens out of the document when it is called: the layout carries
 * the paper ink and the plot grid in force, and a lone series is drawn in the
 * series ramp. That is what makes the chart follow the theme instead of being
 * painted dark once and left dark on light paper.
 *
 * Building a layout is not enough by itself, because a Plotly layout is a
 * plain object handed over once: `useChartTheme` subscribes to the resolved
 * theme so a flip re-renders this component and a fresh layout reaches the
 * plot. The witness for all of it lives in this file's tests, which assert on
 * what the plot receives rather than on the frame around it.
 */
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { PlotParams } from 'react-plotly.js'

import { axisTitle, layout as chartLayout, traceStyle } from '@/lib/chart-theme'
import { getScaleFactorNm } from '@/lib/units'
import { useThemeStore } from '@/stores/useThemeStore'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

/** Room the plot takes inside whatever surface frames it. */
const PLOT_HEIGHT = '300px'

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

/**
 * Re-render this chart when the active theme changes.
 *
 * `chart-theme` reads its colours from the document while a layout is built, so
 * a chart rendered during a theme flip is already drawn in the new theme. What
 * it cannot do on its own is ask for that render. Subscribing to the resolved
 * theme is the request; the value itself is not used, and that is deliberate —
 * everything derived from it is read at build time, not stored.
 */
function useChartTheme(): void {
  useThemeStore((state) => state.resolved)
}

/**
 * The chart's layout: the kit's shared layout plus this chart's two axes.
 *
 * Nothing below is a colour. Backgrounds, ink, grid and hover colours all come
 * from `chart-theme.layout()`, which leaves the plot surface transparent so the
 * panel behind the chart is the surface in both themes.
 */
function buildLayout(showLegend: boolean): PlotParams['layout'] {
  const base = chartLayout({ showlegend: showLegend })
  const xaxis = base.xaxis as Record<string, unknown>
  const yaxis = base.yaxis as Record<string, unknown>

  // SAFETY: `chart-theme.layout()` returns a plain record rather than Plotly's
  // own `Layout`, whose type covers a surface far larger than this chart uses.
  // The axis font, grid and automargin are already in place; only the titles
  // and the axis-specific text are ours.
  return {
    ...base,
    xaxis: { ...xaxis, title: { text: axisTitle({ quantity: 'log10 N' }) } },
    yaxis: {
      ...yaxis,
      title: { text: axisTitle({ quantity: 'log10 Rg', unit: 'nm' }) },
    },
  } as unknown as PlotParams['layout']
}

/**
 * One Plotly trace, styled by the kit's triple encoding: colour, dash pattern
 * and marker glyph, all indexed by the series position, so the plot stays
 * readable in greyscale. `boundColor` is the caller's own binding (the Compare
 * page ties each curve to its simulation's colour, shared with the grid cell)
 * and wins over the ramp; the dash and the glyph still follow the index.
 */
function buildTrace(
  index: number,
  name: string,
  x: number[],
  y: number[],
  boundColor?: string,
  soleSeries?: boolean,
): NonNullable<PlotParams['data']>[number] {
  const style = traceStyle(index, { color: boundColor, name, soleSeries })
  // SAFETY: `chart-theme` types `mode` and `line.dash` as `string` on purpose —
  // it is a plain data module with no dependency on Plotly's types. The values
  // it returns are Plotly's own (a mode from its enum, a dash pattern in its
  // pixel-list syntax), pinned by that module's tests, so the cast states the
  // one fact TypeScript cannot know without importing all of Plotly here.
  return {
    x,
    y,
    type: 'scatter',
    mode: style.mode,
    name: style.name,
    line: style.line,
    marker: style.marker,
    showlegend: style.showlegend,
  } as unknown as NonNullable<PlotParams['data']>[number]
}

/** Log10 of N and of Rg in nm — the two axes of this plot. */
function logSeries(rgEvolution: number[], parameters?: Record<string, unknown>) {
  const scale = getScaleFactorNm(parameters)
  const n = rgEvolution.map((_, i) => i + 1)
  return {
    xData: n.map((v) => Math.log10(v)),
    yData: rgEvolution.map((v) => Math.log10(v * scale)),
  }
}

// ---------------------------------------------------------------------------
// Single-series implementation.
// ---------------------------------------------------------------------------
function SingleSeriesChart({
  rgEvolution,
  parameters,
  className,
}: RgEvolutionChartSingleProps) {
  useChartTheme()

  const { xData, yData } = useMemo(() => {
    if (rgEvolution.length === 0) {
      return { xData: [] as number[], yData: [] as number[] }
    }
    return logSeries(rgEvolution, parameters)
  }, [rgEvolution, parameters])

  if (rgEvolution.length === 0) {
    return (
      <div className={className}>
        <p className="hint py-8 text-center">No evolution data available</p>
      </div>
    )
  }

  // A lone series needs no cues to tell it apart: the kit draws it solid and
  // unmarked, in the ramp colour the active theme declares.
  const plotData: PlotParams['data'] = [
    buildTrace(0, 'Rg vs N', xData, yData, undefined, true),
  ]

  return (
    <div className={className}>
      <Plot
        data={plotData}
        layout={buildLayout(false)}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%', height: PLOT_HEIGHT }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-series implementation (T15).
// ---------------------------------------------------------------------------
function MultiSeriesChart({ series, className }: RgEvolutionChartMultiProps) {
  useChartTheme()

  const { traces, missingLabels } = useMemo(() => {
    const out: PlotParams['data'] = []
    const missing: string[] = []

    for (let index = 0; index < series.length; index++) {
      const s = series[index]
      if (!s.rgEvolution || s.rgEvolution.length === 0) {
        missing.push(s.label)
        continue
      }
      const { xData, yData } = logSeries(s.rgEvolution, s.parameters)
      out.push(buildTrace(index, s.label, xData, yData, s.color))
    }

    return { traces: out, missingLabels: missing }
  }, [series])

  // Empty state: every series was missing (or series[] itself empty).
  if (traces.length === 0) {
    return (
      <div className={className} data-testid="rg-chart-empty">
        <p className="hint py-8 text-center">No evolution data available</p>
        {missingLabels.length > 0 && (
          <ul
            data-testid="rg-chart-missing-list"
            className="hint mt-2 space-y-0.5 text-center text-xs"
          >
            {missingLabels.map((label) => (
              <li key={label}>{label}: no evolution data available</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className={className} data-testid="rg-chart-multi">
      <Plot
        data={traces}
        layout={buildLayout(true)}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%', height: PLOT_HEIGHT }}
      />
      {missingLabels.length > 0 && (
        <ul
          data-testid="rg-chart-missing-list"
          className="hint mt-2 space-y-0.5 text-xs"
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
