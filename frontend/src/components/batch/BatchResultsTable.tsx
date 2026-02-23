'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Label } from '@/components/ui/label'
import { Download, ExternalLink, RefreshCw, Calculator } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import type { ParametricStudyResults, BoxCountingResult } from '@/lib/types'

/**
 * Perform linear regression on log-log data to calculate fractal dimension.
 * Returns { slope, r_squared, std_error }
 */
function linearRegression(x: number[], y: number[]): { slope: number; r_squared: number; std_error: number } {
  const n = x.length
  if (n < 2) return { slope: 0, r_squared: 0, std_error: 0 }

  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0)
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0)
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0)

  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-10) return { slope: 0, r_squared: 0, std_error: 0 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // Calculate R²
  const yMean = sumY / n
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0)
  const ssRes = y.reduce((acc, yi, i) => acc + (yi - (slope * x[i] + intercept)) ** 2, 0)
  const r_squared = ssTot > 0 ? 1 - ssRes / ssTot : 0

  // Calculate standard error of slope
  const std_error = n > 2 ? Math.sqrt(ssRes / (n - 2)) / Math.sqrt(sumX2 - sumX * sumX / n) : 0

  // Box-counting: Df = -slope (since log(N) = Df * log(1/r) + const)
  return { slope: -slope, r_squared, std_error }
}

/**
 * Recalculate box-counting Df with N initial points skipped.
 */
function recalculateBoxCountingDf(bc: BoxCountingResult | undefined, skipPoints: number): BoxCountingResult | undefined {
  if (!bc || !bc.log_scales || !bc.log_values) return bc
  if (skipPoints <= 0) return bc

  const logScales = bc.log_scales.slice(skipPoints)
  const logValues = bc.log_values.slice(skipPoints)

  if (logScales.length < 2) return bc

  const { slope, r_squared, std_error } = linearRegression(logScales, logValues)

  return {
    ...bc,
    dimension: slope,
    r_squared,
    std_error,
  }
}

interface BatchResultsTableProps {
  data: ParametricStudyResults
  projectId: string
  onExport: () => void
  onRefresh: () => void
  onRunBoxCounting?: () => Promise<void>
  isExporting?: boolean
  isRunningBoxCounting?: boolean
}

export function BatchResultsTable({
  data,
  projectId,
  onExport,
  onRefresh,
  onRunBoxCounting,
  isExporting,
  isRunningBoxCounting,
}: BatchResultsTableProps) {
  const progress = (data.progress.completed / data.progress.total) * 100
  const isComplete = data.progress.running === 0

  // State for box-counting skip points slider
  const [bcSkipPoints, setBcSkipPoints] = useState(0)

  // Get the varying parameter names from the grid
  const varyingParams = useMemo(() => Object.keys(data.parameter_grid), [data.parameter_grid])

  // Find max number of box-counting data points across all simulations
  const maxBcPoints = useMemo(() => {
    let max = 0
    for (const result of data.results) {
      const bc = result.box_counting
      if (bc?.log_scales) {
        max = Math.max(max, bc.log_scales.length)
      }
    }
    return max
  }, [data.results])

  // Check if any results have box-counting data
  const hasBoxCountingData = maxBcPoints > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{data.name}</CardTitle>
            {data.description && (
              <p className="text-sm text-muted-foreground mt-1">{data.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            {onRunBoxCounting && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRunBoxCounting}
                disabled={isRunningBoxCounting || data.progress.completed === 0}
              >
                <Calculator className="h-4 w-4 mr-1" />
                {isRunningBoxCounting ? 'Running...' : 'Run Box-Counting'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={isExporting || data.progress.completed === 0}
            >
              <Download className="h-4 w-4 mr-1" />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              Progress: {data.progress.completed}/{data.progress.total} completed
              {data.progress.failed > 0 && (
                <span className="text-destructive ml-2">
                  ({data.progress.failed} failed)
                </span>
              )}
            </span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <Progress value={progress} />
        </div>

        {/* Algorithm info */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>Algorithm: <span className="font-medium text-foreground">{data.base_algorithm}</span></span>
          <span>Seeds: <span className="font-medium text-foreground">{data.progress.total / Object.values(data.parameter_grid).reduce((acc, v) => acc * (Array.isArray(v) ? v.length : 1), 1)}</span></span>
        </div>

        {/* Box-Counting Skip Points Slider */}
        {hasBoxCountingData && (
          <div className="p-3 border rounded-lg bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Box-Counting: Skip first N points
              </Label>
              <span className="text-sm font-mono bg-primary/10 px-2 py-0.5 rounded">
                {bcSkipPoints} / {maxBcPoints - 2}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, maxBcPoints - 2)}
              value={bcSkipPoints}
              onChange={(e) => setBcSkipPoints(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            />
            <p className="text-xs text-muted-foreground">
              Adjust to exclude initial points from linear regression (useful for removing small-scale noise)
            </p>
          </div>
        )}

        {/* Results Table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  {varyingParams.map((param) => (
                    <th key={param} className="px-3 py-2 text-left font-medium">
                      {param.replace(/_/g, ' ')}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Df</th>
                  <th className="px-3 py-2 text-right font-medium">kf</th>
                  <th className="px-3 py-2 text-right font-medium">Rg</th>
                  <th className="px-3 py-2 text-right font-medium">Anisotropy</th>
                  <th className="px-3 py-2 text-right font-medium">Porosity</th>
                  <th className="px-3 py-2 text-right font-medium">BC Df</th>
                  <th className="px-3 py-2 text-center font-medium">View</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.results.map((result) => (
                  <tr key={result.simulation_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          result.status === 'completed'
                            ? 'default'
                            : result.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {result.status}
                      </Badge>
                    </td>
                    {varyingParams.map((param) => (
                      <td key={param} className="px-3 py-2 font-mono">
                        {String(result.parameters[param] ?? '-')}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono">
                      {result.fractal_dimension ? formatNumber(result.fractal_dimension, 3) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {result.prefactor ? formatNumber(result.prefactor, 3) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {result.radius_of_gyration ? formatNumber(result.radius_of_gyration, 2) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {result.anisotropy ? formatNumber(result.anisotropy, 2) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {result.porosity ? `${(result.porosity * 100).toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {(() => {
                        const recalcBc = recalculateBoxCountingDf(result.box_counting, bcSkipPoints)
                        return recalcBc?.dimension
                          ? formatNumber(recalcBc.dimension, 3)
                          : '-'
                      })()}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {result.status === 'completed' && (
                        <Link
                          href={`/projects/${projectId}/simulations/${result.simulation_id}`}
                          className="inline-flex items-center text-primary hover:underline"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary Stats */}
        {data.progress.completed > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 pt-2">
            {(() => {
              const completed = data.results.filter((r) => r.status === 'completed' && r.fractal_dimension)
              if (completed.length === 0) return null

              const dfValues = completed.map((r) => r.fractal_dimension!)
              const avgDf = dfValues.reduce((a, b) => a + b, 0) / dfValues.length
              const stdDf = Math.sqrt(
                dfValues.reduce((acc, v) => acc + Math.pow(v - avgDf, 2), 0) / dfValues.length
              )

              const kfValues = completed.filter((r) => r.prefactor).map((r) => r.prefactor!)
              const avgKf = kfValues.length > 0
                ? kfValues.reduce((a, b) => a + b, 0) / kfValues.length
                : 0

              const porosityValues = completed.filter((r) => r.porosity != null).map((r) => r.porosity!)
              const avgPorosity = porosityValues.length > 0
                ? porosityValues.reduce((a, b) => a + b, 0) / porosityValues.length
                : 0

              const bcValues = completed
                .map((r) => recalculateBoxCountingDf(r.box_counting, bcSkipPoints))
                .filter((bc) => bc?.dimension)
                .map((bc) => bc!.dimension)
              const avgBcDf = bcValues.length > 0
                ? bcValues.reduce((a, b) => a + b, 0) / bcValues.length
                : null

              return (
                <>
                  <div className="text-center p-2 bg-muted/50 rounded">
                    <p className="text-lg font-bold">{formatNumber(avgDf, 3)}</p>
                    <p className="text-xs text-muted-foreground">Avg. Df</p>
                  </div>
                  <div className="text-center p-2 bg-muted/50 rounded">
                    <p className="text-lg font-bold">{formatNumber(stdDf, 3)}</p>
                    <p className="text-xs text-muted-foreground">Std. Dev. Df</p>
                  </div>
                  <div className="text-center p-2 bg-muted/50 rounded">
                    <p className="text-lg font-bold">{formatNumber(avgKf, 3)}</p>
                    <p className="text-xs text-muted-foreground">Avg. kf</p>
                  </div>
                  <div className="text-center p-2 bg-muted/50 rounded">
                    <p className="text-lg font-bold">{(avgPorosity * 100).toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">Avg. Porosity</p>
                  </div>
                  {avgBcDf !== null && (
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <p className="text-lg font-bold">{formatNumber(avgBcDf, 3)}</p>
                      <p className="text-xs text-muted-foreground">Avg. BC Df</p>
                    </div>
                  )}
                  <div className="text-center p-2 bg-muted/50 rounded">
                    <p className="text-lg font-bold">{completed.length}</p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
