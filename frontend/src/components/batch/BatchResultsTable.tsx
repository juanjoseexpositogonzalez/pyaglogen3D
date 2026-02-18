'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import type { ParametricStudyResults } from '@/lib/types'

interface BatchResultsTableProps {
  data: ParametricStudyResults
  projectId: string
  onExport: () => void
  onRefresh: () => void
  isExporting?: boolean
}

export function BatchResultsTable({
  data,
  projectId,
  onExport,
  onRefresh,
  isExporting,
}: BatchResultsTableProps) {
  const progress = (data.progress.completed / data.progress.total) * 100
  const isComplete = data.progress.running === 0

  // Get the varying parameter names from the grid
  const varyingParams = useMemo(() => Object.keys(data.parameter_grid), [data.parameter_grid])

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
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
