'use client'

import { useRef, useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { formatNumber, exportData, type DataExportFormat } from '@/lib/utils'
import { backgroundColors, type BackgroundOption } from '@/stores/viewerStore'
import { Download, FileSpreadsheet, RotateCcw } from 'lucide-react'
import type { PlotParams } from 'react-plotly.js'

// Dynamic import for Plotly (client-side only)
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

/** Limiting case line data */
export interface LimitingCaseLine {
  name: string
  df: number
  kf: number
  color: string
  /** Optional Rg/rp calculator for showing exact data points */
  rgRpFormula?: (n: number) => number
}

interface FractalPlotProps {
  rgEvolution: number[]
  /** Reported fractal dimension from simulation (for comparison) */
  fractalDimension: number
  /** Reported prefactor from simulation (for comparison) */
  prefactor: number
  primaryParticleRadius?: number
  /** Total number of particles in the simulation (for correct N values) */
  totalParticles?: number
  /** Height of the plot in pixels */
  height?: number
  /** Limiting case reference lines to show */
  limitingCases?: LimitingCaseLine[]
}

/**
 * Compute linear regression on log-log data.
 * Returns { slope, intercept, rSquared }
 */
function computeRegression(logX: number[], logY: number[]) {
  const n = logX.length
  if (n < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 }
  }

  const sumX = logX.reduce((a, b) => a + b, 0)
  const sumY = logY.reduce((a, b) => a + b, 0)
  const sumXY = logX.reduce((acc, x, i) => acc + x * logY[i], 0)
  const sumXX = logX.reduce((acc, x) => acc + x * x, 0)

  const denom = n * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-15) {
    return { slope: 0, intercept: sumY / n, rSquared: 0 }
  }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // Calculate R²
  const meanY = sumY / n
  let ssTot = 0
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * logX[i]
    ssRes += Math.pow(logY[i] - predicted, 2)
    ssTot += Math.pow(logY[i] - meanY, 2)
  }
  const rSquared = ssTot > 1e-15 ? 1 - ssRes / ssTot : 0

  return { slope, intercept, rSquared }
}

const backgroundOptions: { value: BackgroundOption; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'light', label: 'Light Gray' },
  { value: 'dark', label: 'Dark' },
  { value: 'black', label: 'Black' },
]

type LegendPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const legendPositionOptions: { value: LegendPosition; label: string }[] = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' },
]

const legendPositionConfig: Record<LegendPosition, { x: number; y: number; xanchor: 'left' | 'right'; yanchor: 'top' | 'bottom' }> = {
  'top-left': { x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top' },
  'top-right': { x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top' },
  'bottom-left': { x: 0.02, y: 0.02, xanchor: 'left', yanchor: 'bottom' },
  'bottom-right': { x: 0.98, y: 0.02, xanchor: 'right', yanchor: 'bottom' },
}

export function FractalPlot({
  rgEvolution,
  fractalDimension: reportedDf,
  prefactor: reportedKf,
  primaryParticleRadius = 1.0,
  totalParticles,
  height = 350,
  limitingCases,
}: FractalPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null)

  // Independent background state for this plot
  const [background, setBackground] = useState<BackgroundOption>('white')
  const [legendPosition, setLegendPosition] = useState<LegendPosition>('top-left')
  const isDark = background !== 'white'

  // Point exclusion for border effects
  const [excludeStart, setExcludeStart] = useState(0) // Exclude first N points (small N)
  const [excludeEnd, setExcludeEnd] = useState(0) // Exclude last N points (large N)

  const rp = primaryParticleRadius

  // Calculate step size for sampled rg_evolution
  // If totalParticles is provided, rg_evolution may be sampled at intervals
  const step = useMemo(() => {
    if (!totalParticles || rgEvolution.length === 0) return 1
    return Math.round(totalParticles / rgEvolution.length)
  }, [totalParticles, rgEvolution.length])

  // Data points: N vs Rg/rp
  // Filter out points where Rg/rp is too small (< 0.1) to avoid log issues
  const filteredData = useMemo(() => {
    const minRgRp = 0.1 // Minimum Rg/rp to include in regression
    const nVals: number[] = []
    const rgRpVals: number[] = []

    for (let i = 0; i < rgEvolution.length; i++) {
      const rgRp = rgEvolution[i] / rp
      if (rgRp >= minRgRp) {
        // Use correct N value based on sampling step
        nVals.push((i + 1) * step)
        rgRpVals.push(rgRp)
      }
    }
    return { nValues: nVals, rgRpValues: rgRpVals }
  }, [rgEvolution, rp, step])

  const { nValues, rgRpValues } = filteredData

  // Log values for regression
  const logRgRp = useMemo(() => rgRpValues.map((v) => Math.log10(v)), [rgRpValues])
  const logN = useMemo(() => nValues.map((v) => Math.log10(v)), [nValues])

  // Split data into included and excluded regions based on sliders
  const { includedIndices, excludedStartIndices, excludedEndIndices } = useMemo(() => {
    const total = nValues.length
    const endIdx = total - excludeEnd
    return {
      includedIndices: Array.from({ length: Math.max(0, endIdx - excludeStart) }, (_, i) => excludeStart + i),
      excludedStartIndices: Array.from({ length: excludeStart }, (_, i) => i),
      excludedEndIndices: Array.from({ length: excludeEnd }, (_, i) => endIdx + i),
    }
  }, [nValues.length, excludeStart, excludeEnd])

  // Get included data for regression
  const includedLogRgRp = useMemo(() => includedIndices.map(i => logRgRp[i]), [includedIndices, logRgRp])
  const includedLogN = useMemo(() => includedIndices.map(i => logN[i]), [includedIndices, logN])

  // Compute ACTUAL regression from included data only
  const regression = useMemo(() => computeRegression(includedLogRgRp, includedLogN), [includedLogRgRp, includedLogN])

  // Actual Df is the slope, actual kf = 10^intercept
  const actualDf = regression.slope
  const actualKf = Math.pow(10, regression.intercept)
  const rSquared = regression.rSquared

  // Fitted line using ACTUAL regression (spans full data range for reference)
  // Include limiting case reference points (N=1 has Rg/rp ≈ 0.77) in range
  const limitingMinRgRp = limitingCases?.length
    ? Math.min(...limitingCases.filter(lc => lc.rgRpFormula).map(lc => lc.rgRpFormula!(1)))
    : undefined
  const dataMinLogRgRp = Math.min(...logRgRp)
  const minLogRgRp = limitingMinRgRp
    ? Math.min(dataMinLogRgRp, Math.log10(limitingMinRgRp))
    : dataMinLogRgRp
  const maxLogRgRp = Math.max(...logRgRp)
  const fitMargin = (maxLogRgRp - minLogRgRp) * 0.05
  const fitX = [minLogRgRp - fitMargin, maxLogRgRp + fitMargin]
  const fitY = fitX.map((x) => regression.intercept + regression.slope * x)

  // Convert to linear scale for Plotly log axes
  const fitXLinear = fitX.map((x) => Math.pow(10, x))
  const fitYLinear = fitY.map((y) => Math.pow(10, y))

  // Colors based on background
  const dataColor = '#3b82f6' // blue-500
  const excludedColor = '#94a3b8' // slate-400 (gray for excluded points)
  const fitColor = '#22c55e' // green-500 (actual fit)
  const bgColor = isDark ? backgroundColors[background] : '#ffffff'
  const paperBgColor = isDark ? (background === 'black' ? '#111' : '#1e293b') : '#f8fafc'
  const gridColor = isDark ? '#334155' : '#e2e8f0'
  const textColor = isDark ? '#e2e8f0' : '#1e293b'

  // Export image function
  const handleImageExport = useCallback((format: 'svg' | 'png') => {
    const Plotly = (window as unknown as { Plotly: {
      downloadImage: (el: HTMLElement, opts: { format: string; width: number; height: number; filename: string }) => void
    } }).Plotly
    if (!Plotly || !plotRef.current) return

    const plotDiv = plotRef.current.querySelector('.js-plotly-plot') as HTMLElement
    if (!plotDiv) return

    Plotly.downloadImage(plotDiv, {
      format,
      width: 1200,
      height: 600,
      filename: `fractal_scaling_Df${formatNumber(actualDf, 2)}_kf${formatNumber(actualKf, 2)}`,
    })
  }, [actualDf, actualKf])

  // Export data function
  const handleDataExport = useCallback((format: DataExportFormat) => {
    const headers = ['N', 'Rg_rp', 'log10_N', 'log10_Rg_rp', 'included']
    const rows = nValues.map((n, i) => [
      n,
      rgRpValues[i],
      logN[i],
      logRgRp[i],
      includedIndices.includes(i) ? 'yes' : 'no',
    ])

    exportData({
      filename: `fractal_scaling_Df${formatNumber(actualDf, 2)}_kf${formatNumber(actualKf, 2)}`,
      headers,
      rows,
      format,
    })
  }, [nValues, rgRpValues, logN, logRgRp, actualDf, actualKf, includedIndices])

  // Calculate axis range that includes limiting case markers if visible
  const axisRanges = useMemo(() => {
    // Default: auto-range based on data
    let xMin = Math.min(...rgRpValues)
    let xMax = Math.max(...rgRpValues)
    let yMin = Math.min(...nValues)
    let yMax = Math.max(...nValues)

    // If showing limiting cases with markers, extend range to include N=1
    if (limitingCases?.some(lc => lc.rgRpFormula)) {
      const exactNs = [1, 2, 3, 4, 5]
      yMin = Math.min(yMin, 0.8) // Slightly below 1 for log scale

      // Include all limiting case Rg/rp values for small N
      for (const lc of limitingCases) {
        if (lc.rgRpFormula) {
          for (const n of exactNs) {
            const rgRp = lc.rgRpFormula(n)
            xMin = Math.min(xMin, rgRp * 0.8)
            xMax = Math.max(xMax, rgRp * 1.2)
          }
        }
      }
    }

    // Convert to log scale for Plotly range (with small padding)
    const logXMin = Math.log10(xMin) - 0.1
    const logXMax = Math.log10(xMax) + 0.1
    const logYMin = Math.log10(yMin) - 0.1
    const logYMax = Math.log10(yMax) + 0.1

    return {
      xRange: [logXMin, logXMax] as [number, number],
      yRange: [logYMin, logYMax] as [number, number],
    }
  }, [rgRpValues, nValues, limitingCases])

  // Generate limiting case line traces (behind data)
  const limitingCaseLineTraces: PlotParams['data'] = []
  // Generate limiting case marker traces (on top of everything)
  const limitingCaseMarkerTraces: PlotParams['data'] = []

  // Add lines and markers for each limiting case
  for (const lc of (limitingCases ?? [])) {
    // Line trace: N = kf × (Rg/rp)^df
    const lineY = fitXLinear.map((rgRp) => lc.kf * Math.pow(rgRp, lc.df))
    limitingCaseLineTraces.push({
      x: fitXLinear,
      y: lineY,
      mode: 'lines' as const,
      type: 'scatter' as const,
      name: `${lc.name} (Df=${lc.df})`,
      line: {
        color: lc.color,
        width: 2,
        dash: 'dash' as const,
      },
      hovertemplate: `${lc.name}<br>N = %{y:.0f}<br>Rg/rp = %{x:.3f}<extra></extra>`,
      legendgroup: lc.name,
    })

    // Data point markers for N=1,2,3,4,5 (exact values) - rendered on top
    if (lc.rgRpFormula) {
      const exactNValues = [1, 2, 3, 4, 5]
      const exactRgRp = exactNValues.map(n => lc.rgRpFormula!(n))

      limitingCaseMarkerTraces.push({
        x: exactRgRp,
        y: exactNValues,
        mode: 'markers' as const,
        type: 'scatter' as const,
        name: `${lc.name} N=1-5`,
        marker: {
          color: lc.color,
          size: 12,
          symbol: 'diamond' as const,
          line: {
            color: isDark ? '#fff' : '#000',
            width: 2,
          },
        },
        hovertemplate: `${lc.name}<br>N = %{y}<br>Rg/rp = %{x:.3f}<extra></extra>`,
        legendgroup: lc.name,
        showlegend: true,
      })
    }
  }

  // Helper to get data points by indices
  const getPointsByIndices = (indices: number[]) => ({
    x: indices.map(i => rgRpValues[i]),
    y: indices.map(i => nValues[i]),
  })

  const excludedStartPoints = getPointsByIndices(excludedStartIndices)
  const excludedEndPoints = getPointsByIndices(excludedEndIndices)
  const includedPoints = getPointsByIndices(includedIndices)

  const plotData: PlotParams['data'] = [
    // Limiting case reference lines (behind data)
    ...limitingCaseLineTraces,
    // Excluded points at start (small N - shown in gray)
    ...(excludedStartIndices.length > 0 ? [{
      x: excludedStartPoints.x,
      y: excludedStartPoints.y,
      mode: 'markers' as const,
      type: 'scatter' as const,
      name: `Excluded start (${excludedStartIndices.length})`,
      marker: {
        color: excludedColor,
        size: 6,
        opacity: 0.5,
        symbol: 'circle-open' as const,
        line: {
          color: excludedColor,
          width: 2,
        },
      },
      hovertemplate: 'N = %{y}<br>Rg/rp = %{x:.3f}<br>(excluded)<extra></extra>',
    }] : []),
    // Excluded points at end (large N - shown in gray)
    ...(excludedEndIndices.length > 0 ? [{
      x: excludedEndPoints.x,
      y: excludedEndPoints.y,
      mode: 'markers' as const,
      type: 'scatter' as const,
      name: `Excluded end (${excludedEndIndices.length})`,
      marker: {
        color: excludedColor,
        size: 6,
        opacity: 0.5,
        symbol: 'circle-open' as const,
        line: {
          color: excludedColor,
          width: 2,
        },
      },
      hovertemplate: 'N = %{y}<br>Rg/rp = %{x:.3f}<br>(excluded)<extra></extra>',
    }] : []),
    // Included data points (used in regression)
    {
      x: includedPoints.x,
      y: includedPoints.y,
      mode: 'markers',
      type: 'scatter',
      name: `Data (${includedIndices.length})`,
      marker: {
        color: dataColor,
        size: 6,
        opacity: 0.8,
        line: {
          color: isDark ? '#60a5fa' : '#1d4ed8',
          width: 1,
        },
      },
      hovertemplate: 'N = %{y}<br>Rg/rp = %{x:.3f}<extra></extra>',
    },
    // Fitted line (actual regression)
    {
      x: fitXLinear,
      y: fitYLinear,
      mode: 'lines',
      type: 'scatter',
      name: `Fit: Df = ${formatNumber(actualDf, 3)}, kf = ${formatNumber(actualKf, 3)}`,
      line: {
        color: fitColor,
        width: 2.5,
      },
      hoverinfo: 'skip',
    },
    // Limiting case markers (on top of everything for visibility)
    ...limitingCaseMarkerTraces,
  ]

  const layout: PlotParams['layout'] = {
    autosize: true,
    height,
    margin: { l: 70, r: 30, t: 40, b: 60 },
    xaxis: {
      title: {
        text: 'R<sub>g</sub> / r<sub>p</sub>',
        font: { size: 14 },
      },
      type: 'log',
      autorange: limitingCases?.length ? false : true,
      range: limitingCases?.length ? axisRanges.xRange : undefined,
      gridcolor: gridColor,
      linecolor: gridColor,
      tickfont: { size: 12 },
      showline: true,
      mirror: true,
    },
    yaxis: {
      title: {
        text: 'N (particles)',
        font: { size: 14 },
      },
      type: 'log',
      autorange: limitingCases?.length ? false : true,
      range: limitingCases?.length ? axisRanges.yRange : undefined,
      gridcolor: gridColor,
      linecolor: gridColor,
      tickfont: { size: 12 },
      showline: true,
      mirror: true,
    },
    showlegend: true,
    legend: {
      ...legendPositionConfig[legendPosition],
      bgcolor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      bordercolor: gridColor,
      borderwidth: 1,
      font: { size: 11 },
    },
    paper_bgcolor: paperBgColor,
    plot_bgcolor: bgColor,
    font: {
      family: 'ui-sans-serif, system-ui, sans-serif',
      color: textColor,
    },
    annotations: [
      {
        x: 0.98,
        y: 0.02,
        xref: 'paper',
        yref: 'paper',
        xanchor: 'right',
        yanchor: 'bottom',
        text: `R² = ${formatNumber(rSquared, 4)}`,
        showarrow: false,
        font: {
          size: 12,
          color: textColor,
        },
        bgcolor: isDark ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.8)',
        borderpad: 4,
      },
    ],
  }

  // Check if reported values differ significantly from actual
  const dfDiff = Math.abs(actualDf - reportedDf)
  const showComparison = dfDiff > 0.05

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span>Fractal Scaling Analysis</span>
            <span className="text-sm font-mono font-normal text-muted-foreground">
              N = {formatNumber(actualKf, 2)} × (R<sub>g</sub>/r<sub>p</sub>)
              <sup>{formatNumber(actualDf, 2)}</sup>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground font-normal">Background:</span>
                <Select
                  value={background}
                  onChange={(e) => setBackground(e.target.value as BackgroundOption)}
                  options={backgroundOptions}
                  className="h-7 text-xs w-28"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground font-normal">Legend:</span>
                <Select
                  value={legendPosition}
                  onChange={(e) => setLegendPosition(e.target.value as LegendPosition)}
                  options={legendPositionOptions}
                  className="h-7 text-xs w-28"
                />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => handleDataExport('csv')} title="Export as CSV">
                <FileSpreadsheet className="h-3 w-3 mr-1" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleDataExport('tsv')} title="Export as TSV">
                <FileSpreadsheet className="h-3 w-3 mr-1" />
                TSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleImageExport('png')} title="Export as PNG">
                <Download className="h-3 w-3 mr-1" />
                PNG
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleImageExport('svg')} title="Export as SVG">
                <Download className="h-3 w-3 mr-1" />
                SVG
              </Button>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div ref={plotRef}>
          <Plot
            data={plotData}
            layout={layout}
            config={{
              displayModeBar: true,
              modeBarButtonsToRemove: [
                'select2d',
                'lasso2d',
                'autoScale2d',
              ],
              displaylogo: false,
              responsive: true,
              toImageButtonOptions: {
                format: 'png',
                filename: `fractal_scaling_Df${formatNumber(actualDf, 2)}`,
                height: 600,
                width: 1200,
                scale: 2,
              },
            }}
            style={{ width: '100%' }}
          />
        </div>

        {/* Point exclusion sliders for border effects */}
        {nValues.length > 4 && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Regression Range Adjustment</Label>
              {(excludeStart > 0 || excludeEnd > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setExcludeStart(0); setExcludeEnd(0); }}
                  className="h-6 px-2 text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Exclude first {excludeStart} point{excludeStart !== 1 ? 's' : ''} (small N)
                </Label>
                <Slider
                  min={0}
                  max={Math.max(0, Math.floor((nValues.length - 3) / 2))}
                  step={1}
                  value={[excludeStart]}
                  onValueChange={([v]) => setExcludeStart(v)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Exclude last {excludeEnd} point{excludeEnd !== 1 ? 's' : ''} (large N)
                </Label>
                <Slider
                  min={0}
                  max={Math.max(0, Math.floor((nValues.length - 3) / 2))}
                  step={1}
                  value={[excludeEnd]}
                  onValueChange={([v]) => setExcludeEnd(v)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Using {includedIndices.length} of {nValues.length} points for regression
              {(excludeStart > 0 || excludeEnd > 0) && (
                <span className="text-amber-600 dark:text-amber-400 ml-1">
                  ({excludeStart + excludeEnd} excluded)
                </span>
              )}
            </p>
          </div>
        )}

        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            Log-log plot of particle count vs normalized radius of gyration
          </p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>D<sub>f</sub> = {formatNumber(actualDf, 3)}</span>
            <span>k<sub>f</sub> = {formatNumber(actualKf, 3)}</span>
            <span>R² = {formatNumber(rSquared, 4)}</span>
          </div>
        </div>
        {showComparison && (
          <div className="text-xs text-amber-600 dark:text-amber-400">
            Note: Reported Df = {formatNumber(reportedDf, 3)} differs from fitted Df = {formatNumber(actualDf, 3)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
