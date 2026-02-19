'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { simulationsApi } from '@/lib/api'
import { backgroundColors, type BackgroundOption } from '@/stores/viewerStore'
import { formatNumber, exportData, type DataExportFormat } from '@/lib/utils'
import { BoxCounting3DResult } from '@/lib/types'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Box, Loader2, Download, FileSpreadsheet, RotateCcw, Image } from 'lucide-react'
import type { PlotParams } from 'react-plotly.js'

// Dynamic import for Plotly (client-side only)
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface BoxCountingAnalysisProps {
  projectId: string
  simulationId: string
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

export function BoxCountingAnalysis({ projectId, simulationId }: BoxCountingAnalysisProps) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<BoxCounting3DResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Independent background and legend position state for this plot
  const [background, setBackground] = useState<BackgroundOption>('white')
  const [legendPosition, setLegendPosition] = useState<LegendPosition>('top-left')
  const isDark = background !== 'white'

  // Manual point exclusion - additional points to exclude beyond auto-detected
  const [excludeStart, setExcludeStart] = useState<number | null>(null)

  // Initialize excludeStart when result arrives
  const effectiveExcludeStart = excludeStart ?? result?.linear_region_start ?? 0

  const handleRunAnalysis = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await simulationsApi.getBoxCounting(projectId, simulationId)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, simulationId])

  // Colors based on background
  const dataColor = '#3b82f6' // blue-500
  const excludedColor = '#94a3b8' // slate-400 (gray for excluded points)
  const fitColor = '#22c55e' // green-500
  const bgColor = isDark ? backgroundColors[background] : '#ffffff'
  const paperBgColor = isDark ? (background === 'black' ? '#111' : '#1e293b') : '#f8fafc'
  const gridColor = isDark ? '#334155' : '#e2e8f0'
  const textColor = isDark ? '#e2e8f0' : '#1e293b'

  // Split data into included and excluded points based on effective exclusion
  const { includedScales, includedValues, excludedScales, excludedValues } = useMemo(() => {
    if (!result) return { includedScales: [], includedValues: [], excludedScales: [], excludedValues: [] }
    return {
      includedScales: result.log_scales.slice(effectiveExcludeStart),
      includedValues: result.log_values.slice(effectiveExcludeStart),
      excludedScales: result.log_scales.slice(0, effectiveExcludeStart),
      excludedValues: result.log_values.slice(0, effectiveExcludeStart),
    }
  }, [result, effectiveExcludeStart])

  // Compute regression with current exclusion settings
  const adjustedRegression = useMemo(() => {
    if (includedScales.length < 2) {
      return { dimension: 0, r_squared: 0, std_error: 0, ci_low: 0, ci_high: 0 }
    }

    const n = includedScales.length
    const sumX = includedScales.reduce((a, b) => a + b, 0)
    const sumY = includedValues.reduce((a, b) => a + b, 0)
    const sumXY = includedScales.reduce((acc, x, i) => acc + x * includedValues[i], 0)
    const sumXX = includedScales.reduce((acc, x) => acc + x * x, 0)

    const denom = n * sumXX - sumX * sumX
    if (Math.abs(denom) < 1e-15) {
      return { dimension: 0, r_squared: 0, std_error: 0, ci_low: 0, ci_high: 0 }
    }

    const slope = (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / n

    // R²
    const meanY = sumY / n
    let ssTot = 0, ssRes = 0
    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * includedScales[i]
      ssRes += Math.pow(includedValues[i] - predicted, 2)
      ssTot += Math.pow(includedValues[i] - meanY, 2)
    }
    const r_squared = ssTot > 1e-15 ? 1 - ssRes / ssTot : 0

    // Standard error and confidence interval
    const mse = ssRes / (n - 2)
    const se_slope = Math.sqrt(mse / (sumXX - sumX * sumX / n))
    const t_value = 2.0  // Approximate t-value for 95% CI
    const ci_low = slope - t_value * se_slope
    const ci_high = slope + t_value * se_slope

    return { dimension: slope, r_squared, std_error: se_slope, ci_low, ci_high }
  }, [includedScales, includedValues])

  // Compute fitted line using adjusted regression
  const fittedLine = useMemo(() => {
    if (!result || includedScales.length < 2) return { x: [], y: [] }
    const minX = Math.min(...result.log_scales)
    const maxX = Math.max(...result.log_scales)
    const margin = (maxX - minX) * 0.05
    const fitX = [minX - margin, maxX + margin]
    // Compute intercept from adjusted regression
    const meanX = includedScales.reduce((a, b) => a + b, 0) / includedScales.length
    const meanY = includedValues.reduce((a, b) => a + b, 0) / includedValues.length
    const intercept = meanY - adjustedRegression.dimension * meanX
    const fitY = fitX.map((x) => adjustedRegression.dimension * x + intercept)
    return { x: fitX, y: fitY }
  }, [result, includedScales, includedValues, adjustedRegression.dimension])

  // Export data function
  const handleDataExport = useCallback((format: DataExportFormat) => {
    if (!result) return

    const headers = ['log_1_epsilon', 'log_N', 'residual', 'included']
    const rows = result.log_scales.map((scale, i) => [
      scale,
      result.log_values[i],
      result.residuals[i] ?? 0,
      i >= effectiveExcludeStart ? 'yes' : 'no',
    ])

    exportData({
      filename: `box_counting_Df${formatNumber(adjustedRegression.dimension, 2)}`,
      headers,
      rows,
      format,
    })
  }, [result, effectiveExcludeStart, adjustedRegression.dimension])

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
      filename: `box_counting_Df${formatNumber(adjustedRegression.dimension, 2)}`,
    })
  }, [adjustedRegression.dimension])

  const plotData: PlotParams['data'] = result ? [
    // Excluded points (shown in gray)
    ...(excludedScales.length > 0 ? [{
      x: excludedScales,
      y: excludedValues,
      mode: 'markers' as const,
      type: 'scatter' as const,
      name: `Excluded (${excludedScales.length})`,
      marker: {
        color: excludedColor,
        size: 7,
        opacity: 0.5,
        symbol: 'circle-open',
        line: {
          color: excludedColor,
          width: 2,
        },
      },
      hovertemplate: 'log(1/ε) = %{x:.2f}<br>log(N) = %{y:.2f}<br>(excluded)<extra></extra>',
    }] : []),
    // Included points (used in regression)
    {
      x: includedScales,
      y: includedValues,
      mode: 'markers',
      type: 'scatter',
      name: `Linear region (${includedScales.length})`,
      marker: {
        color: dataColor,
        size: 8,
        opacity: 0.9,
        line: {
          color: isDark ? '#60a5fa' : '#1d4ed8',
          width: 1,
        },
      },
      hovertemplate: 'log(1/ε) = %{x:.2f}<br>log(N) = %{y:.2f}<extra></extra>',
    },
    // Fitted line
    {
      x: fittedLine.x,
      y: fittedLine.y,
      mode: 'lines',
      type: 'scatter',
      name: `Fit: Df = ${formatNumber(adjustedRegression.dimension, 3)}`,
      line: {
        color: fitColor,
        width: 2.5,
      },
      hoverinfo: 'skip',
    },
  ] : []

  const layout: PlotParams['layout'] = {
    autosize: true,
    height: 300,
    margin: { l: 60, r: 30, t: 30, b: 50 },
    xaxis: {
      title: { text: 'log(1/ε)', font: { size: 14 } },
      gridcolor: gridColor,
      linecolor: gridColor,
      tickfont: { size: 12 },
      showline: true,
      mirror: true,
    },
    yaxis: {
      title: { text: 'log(N)', font: { size: 14 } },
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
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Box className="h-5 w-5" />
            3D Box-Counting Analysis
          </div>
          {result && (
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
                <Button variant="outline" size="sm" onClick={() => handleDataExport('csv')} title="Export data as CSV">
                  <FileSpreadsheet className="h-3 w-3 mr-1" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDataExport('tsv')} title="Export data as TSV">
                  <FileSpreadsheet className="h-3 w-3 mr-1" />
                  TSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleImageExport('png')} title="Export plot as PNG">
                  <Image className="h-3 w-3 mr-1" />
                  PNG
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleImageExport('svg')} title="Export plot as SVG">
                  <Image className="h-3 w-3 mr-1" />
                  SVG
                </Button>
              </div>
            </div>
          )}
        </CardTitle>
        <CardDescription>
          Compute fractal dimension using the box-counting method on the full 3D structure.
          This method voxelizes the agglomerate and counts occupied boxes at multiple scales.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!result && !isLoading && (
          <div className="flex flex-col items-center py-6 gap-4">
            <p className="text-sm text-muted-foreground text-center max-w-md">
              The box-counting method provides an independent measure of fractal dimension
              by analyzing the 3D spatial distribution of particles at different scales.
            </p>
            <Button onClick={handleRunAnalysis} disabled={isLoading}>
              <Box className="h-4 w-4 mr-2" />
              Run Box-Counting Analysis
            </Button>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Running analysis...</p>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive p-4 rounded-md">
            <p className="font-medium">Analysis failed</p>
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={handleRunAnalysis}>
              Retry
            </Button>
          </div>
        )}

        {result && !isLoading && (
          <div className="space-y-4">
            {/* Results summary - using adjusted regression values */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Fractal Dimension</p>
                <p className="text-2xl font-bold font-mono">{formatNumber(adjustedRegression.dimension, 3)}</p>
                {excludeStart !== null && excludeStart !== result.linear_region_start && (
                  <p className="text-xs text-muted-foreground">
                    (auto: {formatNumber(result.dimension, 3)})
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">R²</p>
                <p className="text-2xl font-bold font-mono">{formatNumber(adjustedRegression.r_squared, 4)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Std. Error</p>
                <p className="text-2xl font-bold font-mono">{formatNumber(adjustedRegression.std_error, 4)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">95% CI</p>
                <p className="text-lg font-bold font-mono">
                  [{formatNumber(adjustedRegression.ci_low, 2)}, {formatNumber(adjustedRegression.ci_high, 2)}]
                </p>
              </div>
            </div>

            {/* Manual point exclusion slider */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">
                  Exclude first {effectiveExcludeStart} point{effectiveExcludeStart !== 1 ? 's' : ''} (small scales)
                </Label>
                {excludeStart !== null && excludeStart !== result.linear_region_start && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExcludeStart(null)}
                    className="h-6 px-2 text-xs"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset to auto
                  </Button>
                )}
              </div>
              <Slider
                min={0}
                max={Math.min(result.log_scales.length - 3, result.linear_region_start + 3)}
                step={1}
                value={[effectiveExcludeStart]}
                onValueChange={([v]) => setExcludeStart(v)}
              />
              <p className="text-xs text-muted-foreground">
                Auto-detected: {result.linear_region_start} | Using {includedScales.length} of {result.log_scales.length} points
              </p>
            </div>

            {/* Log-log plot */}
            <div ref={plotRef}>
              <Plot
                data={plotData}
                layout={layout}
                config={{
                  displayModeBar: true,
                  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
                  displaylogo: false,
                  responsive: true,
                  toImageButtonOptions: {
                    format: 'png',
                    filename: `box_counting_Df${formatNumber(result.dimension, 2)}`,
                    height: 600,
                    width: 1200,
                    scale: 2,
                  },
                }}
                style={{ width: '100%' }}
              />
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <div className="flex gap-4">
                <span>
                  {formatNumber(result.execution_time_ms, 0)}ms
                </span>
                <span>
                  {includedScales.length} of {result.log_scales.length} points used
                  {effectiveExcludeStart > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-1">
                      ({effectiveExcludeStart} excluded)
                    </span>
                  )}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setExcludeStart(null); handleRunAnalysis(); }}>
                Re-run Analysis
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
