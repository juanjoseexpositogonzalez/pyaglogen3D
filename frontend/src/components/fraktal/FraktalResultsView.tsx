'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MetricsCard } from '@/components/common/MetricsCard'
import type { FraktalAnalysis } from '@/lib/types'

interface FraktalResultsViewProps {
  analysis: FraktalAnalysis
}

export function FraktalResultsView({ analysis }: FraktalResultsViewProps) {
  const { results, status, model, source_type } = analysis

  const formatNumber = (value: number | null | undefined, decimals = 4): string => {
    if (value === null || value === undefined) return 'N/A'
    return value.toFixed(decimals)
  }

  const formatLargeNumber = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return 'N/A'
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
    return value.toFixed(2)
  }

  const modelLabels: Record<string, string> = {
    granulated_2012: 'Granulated 2012',
    voxel_2018: 'Voxel 2018',
  }

  const sourceLabels: Record<string, string> = {
    uploaded_image: 'Uploaded Image',
    simulation_projection: 'Simulation Projection',
  }

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>FRAKTAL Analysis Results</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{modelLabels[model]}</Badge>
              <Badge variant="secondary">{sourceLabels[source_type]}</Badge>
              <StatusBadge status={status} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Created:</span>
              <p className="font-medium">{new Date(analysis.created_at).toLocaleString()}</p>
            </div>
            {analysis.completed_at && (
              <div>
                <span className="text-muted-foreground">Completed:</span>
                <p className="font-medium">{new Date(analysis.completed_at).toLocaleString()}</p>
              </div>
            )}
            {analysis.execution_time_ms && (
              <div>
                <span className="text-muted-foreground">Execution Time:</span>
                <p className="font-medium">{analysis.execution_time_ms} ms</p>
              </div>
            )}
            {analysis.engine_version && (
              <div>
                <span className="text-muted-foreground">Engine:</span>
                <p className="font-medium">aglogen_core {analysis.engine_version}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {status === 'failed' && analysis.error_message && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardHeader>
            <CardTitle className="text-red-600">Analysis Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-600">{analysis.error_message}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricsCard
              title="Fractal Dimension"
              value={formatNumber(results.df, 4)}
              subtitle="Df"
              highlight
            />
            <MetricsCard
              title="Prefactor"
              value={formatNumber(results.kf, 4)}
              subtitle="kf"
            />
            <MetricsCard
              title="Primary Particles"
              value={results.npo?.toLocaleString() || 'N/A'}
              subtitle="Npo"
            />
            <MetricsCard
              title="Overlap Exponent"
              value={formatNumber(results.zf, 4)}
              subtitle="zf"
            />
          </div>

          {/* Geometry Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Geometry</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <span className="text-sm text-muted-foreground">Radius of Gyration (Rg)</span>
                  <p className="text-2xl font-bold">{formatNumber(results.rg, 2)} nm</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Projected Area (Ap)</span>
                  <p className="text-2xl font-bold">{formatLargeNumber(results.ap)} nm²</p>
                </div>
                {results.jf !== null && (
                  <div>
                    <span className="text-sm text-muted-foreground">Coordination Index (Jf)</span>
                    <p className="text-2xl font-bold">{formatNumber(results.jf, 4)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Physical Properties */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Physical Properties</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <span className="text-sm text-muted-foreground">Volume</span>
                  <p className="text-2xl font-bold">{formatLargeNumber(results.volume)} nm³</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Surface Area</span>
                  <p className="text-2xl font-bold">{formatLargeNumber(results.surface_area)} nm²</p>
                </div>
                {results.mass > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground">Mass</span>
                    <p className="text-2xl font-bold">{formatLargeNumber(results.mass)} fg</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Analysis Parameters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Analysis Parameters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">npix:</span>
                  <p className="font-medium">{analysis.npix} px/100nm</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Scale:</span>
                  <p className="font-medium">{analysis.escala} nm</p>
                </div>
                {model === 'granulated_2012' && analysis.dpo && (
                  <div>
                    <span className="text-muted-foreground">dpo:</span>
                    <p className="font-medium">{analysis.dpo} nm</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Delta:</span>
                  <p className="font-medium">{analysis.delta}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">3D Correction:</span>
                  <p className="font-medium">{analysis.correction_3d ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Pixel Range:</span>
                  <p className="font-medium">{analysis.pixel_min} - {analysis.pixel_max}</p>
                </div>
                {model === 'granulated_2012' && (
                  <div>
                    <span className="text-muted-foreground">npo Limit:</span>
                    <p className="font-medium">{analysis.npo_limit}</p>
                  </div>
                )}
                {model === 'voxel_2018' && (
                  <div>
                    <span className="text-muted-foreground">m Exponent:</span>
                    <p className="font-medium">{analysis.m_exponent}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Projection Parameters (if from simulation) */}
          {source_type === 'simulation_projection' && analysis.projection_params && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Projection Parameters</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Azimuth:</span>
                    <p className="font-medium">{analysis.projection_params.azimuth}°</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Elevation:</span>
                    <p className="font-medium">{analysis.projection_params.elevation}°</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Resolution:</span>
                    <p className="font-medium">{analysis.projection_params.resolution} px</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Loading/Running State */}
      {(status === 'queued' || status === 'running') && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">
              {status === 'queued' ? 'Analysis queued...' : 'Running FRAKTAL analysis...'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
