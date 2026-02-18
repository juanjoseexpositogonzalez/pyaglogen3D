'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MetricsCard } from '@/components/common/MetricsCard'
import { fraktalApi } from '@/lib/api'
import type { FraktalAnalysis, CreateFraktalFromImageInput } from '@/lib/types'

interface FraktalResultsViewProps {
  analysis: FraktalAnalysis
  projectId: string
  onComparisonCreated?: (newAnalysis: FraktalAnalysis) => void
}

export function FraktalResultsView({ analysis, projectId, onComparisonCreated }: FraktalResultsViewProps) {
  const { results, status, model, source_type } = analysis
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [rerunLoading, setRerunLoading] = useState(false)
  const [comparisonAnalysis, setComparisonAnalysis] = useState<FraktalAnalysis | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)

  // Load original image for uploaded_image source
  useEffect(() => {
    let blobUrl: string | null = null

    if (source_type === 'uploaded_image' && (status === 'completed' || status === 'failed')) {
      setImageLoading(true)
      fraktalApi.getOriginalImage(projectId, analysis.id)
        .then(blob => {
          blobUrl = URL.createObjectURL(blob)
          setImageUrl(blobUrl)
        })
        .catch(err => {
          console.error('Failed to load image:', err)
        })
        .finally(() => {
          setImageLoading(false)
        })
    }

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [source_type, status, projectId, analysis.id])

  // Poll for comparison analysis status
  useEffect(() => {
    if (!comparisonAnalysis) return
    if (comparisonAnalysis.status === 'completed' || comparisonAnalysis.status === 'failed') return

    const interval = setInterval(async () => {
      try {
        const updated = await fraktalApi.get(projectId, comparisonAnalysis.id)
        setComparisonAnalysis(updated)
        if (updated.status === 'completed' || updated.status === 'failed') {
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Failed to poll comparison analysis:', err)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [comparisonAnalysis, projectId])

  // Re-run analysis with suggested dpo
  const handleRerunWithSuggestedDpo = useCallback(async () => {
    if (!results?.dpo_estimated || source_type !== 'uploaded_image') return

    setRerunLoading(true)
    setComparisonError(null)

    try {
      // Get the original image as base64
      const imageBlob = await fraktalApi.getOriginalImage(projectId, analysis.id)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          const result = reader.result as string
          // Remove data URL prefix
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(imageBlob)
      })

      // Create new analysis with suggested dpo
      const newAnalysisData: CreateFraktalFromImageInput = {
        source_type: 'uploaded_image',
        image: base64,
        original_filename: analysis.original_filename || 'rerun_image.png',
        original_content_type: analysis.original_content_type || 'image/png',
        model: model as 'granulated_2012' | 'voxel_2018',
        npix: analysis.npix,
        dpo: Math.round(results.dpo_estimated),  // Use suggested dpo
        delta: analysis.delta,
        correction_3d: analysis.correction_3d,
        pixel_min: analysis.pixel_min,
        pixel_max: analysis.pixel_max,
        npo_limit: analysis.npo_limit,
        escala: analysis.escala,
      }

      const newAnalysis = await fraktalApi.create(projectId, newAnalysisData)
      setComparisonAnalysis(newAnalysis)
      onComparisonCreated?.(newAnalysis)
    } catch (err) {
      console.error('Failed to create comparison analysis:', err)
      setComparisonError(err instanceof Error ? err.message : 'Failed to create comparison analysis')
    } finally {
      setRerunLoading(false)
    }
  }, [results, source_type, projectId, analysis, model, onComparisonCreated])

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

      {/* Original Image */}
      {source_type === 'uploaded_image' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Analyzed Image</CardTitle>
          </CardHeader>
          <CardContent>
            {imageLoading ? (
              <div className="flex items-center justify-center h-64 bg-muted/50 rounded-lg">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : imageUrl ? (
              <div className="flex justify-center">
                <img
                  src={imageUrl}
                  alt="Analyzed aggregate"
                  className="max-h-96 object-contain rounded-lg border"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 bg-muted/50 rounded-lg">
                <p className="text-muted-foreground">Image not available</p>
              </div>
            )}
            {analysis.original_filename && (
              <p className="text-sm text-muted-foreground mt-2 text-center">
                {analysis.original_filename}
              </p>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* NPO Mismatch Warning */}
      {results && results.npo_aligned === false && results.npo_visual > 5 && !comparisonAnalysis && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardHeader>
            <CardTitle className="text-yellow-600">Parameter Mismatch Detected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-yellow-700">
              Calculated particles (<strong>{results.npo?.toLocaleString() ?? 'N/A'}</strong>) differs significantly from
              visual estimate (<strong>{results.npo_visual}</strong>)
              {results.npo_ratio != null && results.npo_ratio > 0 && (
                <> - ratio: <strong>{results.npo_ratio.toFixed(1)}x</strong></>
              )}
            </p>
            {results.dpo_estimated != null && results.dpo_estimated > 0 && (
              <p className="text-yellow-700 font-medium">
                Suggested dpo: <strong>{results.dpo_estimated.toFixed(1)} nm</strong> (current: {analysis.dpo ?? 'N/A'} nm)
              </p>
            )}
            {comparisonError && (
              <p className="text-red-600 text-sm">{comparisonError}</p>
            )}
            {source_type === 'uploaded_image' && results.dpo_estimated > 0 && (
              <Button
                onClick={handleRerunWithSuggestedDpo}
                disabled={rerunLoading}
                variant="outline"
                className="border-yellow-500 text-yellow-700 hover:bg-yellow-100"
              >
                {rerunLoading ? (
                  <>
                    <span className="animate-spin mr-2">⟳</span>
                    Re-running...
                  </>
                ) : (
                  <>Re-run with dpo = {Math.round(results.dpo_estimated)} nm</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricsCard
              label="Fractal Dimension (Df)"
              value={formatNumber(results.df, 4)}
            />
            <MetricsCard
              label="Prefactor (kf)"
              value={formatNumber(results.kf, 4)}
            />
            <MetricsCard
              label="Primary Particles (npo)"
              value={results.npo?.toLocaleString() || 'N/A'}
              subvalue={results.npo_visual > 0 ? `~${results.npo_visual} visual estimate` : undefined}
            />
            <MetricsCard
              label="Overlap Exponent (zf)"
              value={formatNumber(results.zf, 4)}
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

      {/* Comparison Results */}
      {comparisonAnalysis && (
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-blue-600">Comparison: Re-run with Suggested dpo</CardTitle>
              <StatusBadge status={comparisonAnalysis.status} />
            </div>
          </CardHeader>
          <CardContent>
            {(comparisonAnalysis.status === 'queued' || comparisonAnalysis.status === 'running') && (
              <div className="py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {comparisonAnalysis.status === 'queued' ? 'Analysis queued...' : 'Running comparison...'}
                </p>
              </div>
            )}

            {comparisonAnalysis.status === 'failed' && (
              <p className="text-red-600">{comparisonAnalysis.error_message || 'Analysis failed'}</p>
            )}

            {comparisonAnalysis.status === 'completed' && comparisonAnalysis.results && (
              <div className="space-y-4">
                {/* Side-by-side comparison table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium">Metric</th>
                        <th className="text-right py-2 font-medium text-yellow-600">Original (dpo={analysis.dpo})</th>
                        <th className="text-right py-2 font-medium text-blue-600">Re-run (dpo={comparisonAnalysis.dpo})</th>
                        <th className="text-right py-2 font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2">Fractal Dimension (Df)</td>
                        <td className="text-right font-mono">{formatNumber(results?.df, 4)}</td>
                        <td className="text-right font-mono">{formatNumber(comparisonAnalysis.results.df, 4)}</td>
                        <td className="text-right font-mono text-muted-foreground">
                          {results?.df && comparisonAnalysis.results.df
                            ? (comparisonAnalysis.results.df - results.df > 0 ? '+' : '') +
                              (comparisonAnalysis.results.df - results.df).toFixed(4)
                            : '-'}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2">Primary Particles (npo)</td>
                        <td className="text-right font-mono">{results?.npo?.toLocaleString() ?? 'N/A'}</td>
                        <td className="text-right font-mono">{comparisonAnalysis.results.npo?.toLocaleString() ?? 'N/A'}</td>
                        <td className="text-right font-mono text-muted-foreground">
                          {results?.npo && comparisonAnalysis.results.npo
                            ? (comparisonAnalysis.results.npo > results.npo ? '+' : '') +
                              (comparisonAnalysis.results.npo - results.npo).toLocaleString()
                            : '-'}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2">Visual Estimate</td>
                        <td className="text-right font-mono">{results?.npo_visual ?? 'N/A'}</td>
                        <td className="text-right font-mono">{comparisonAnalysis.results.npo_visual ?? 'N/A'}</td>
                        <td className="text-right font-mono text-muted-foreground">-</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2">NPO Aligned</td>
                        <td className="text-right">
                          <Badge variant={results?.npo_aligned ? 'default' : 'destructive'}>
                            {results?.npo_aligned ? 'Yes' : 'No'}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <Badge variant={comparisonAnalysis.results.npo_aligned ? 'default' : 'destructive'}>
                            {comparisonAnalysis.results.npo_aligned ? 'Yes' : 'No'}
                          </Badge>
                        </td>
                        <td className="text-right">
                          {!results?.npo_aligned && comparisonAnalysis.results.npo_aligned && (
                            <span className="text-green-600">✓ Fixed</span>
                          )}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2">Prefactor (kf)</td>
                        <td className="text-right font-mono">{formatNumber(results?.kf, 4)}</td>
                        <td className="text-right font-mono">{formatNumber(comparisonAnalysis.results.kf, 4)}</td>
                        <td className="text-right font-mono text-muted-foreground">
                          {results?.kf && comparisonAnalysis.results.kf
                            ? (comparisonAnalysis.results.kf - results.kf > 0 ? '+' : '') +
                              (comparisonAnalysis.results.kf - results.kf).toFixed(4)
                            : '-'}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2">Overlap Exponent (zf)</td>
                        <td className="text-right font-mono">{formatNumber(results?.zf, 4)}</td>
                        <td className="text-right font-mono">{formatNumber(comparisonAnalysis.results.zf, 4)}</td>
                        <td className="text-right font-mono text-muted-foreground">
                          {results?.zf && comparisonAnalysis.results.zf
                            ? (comparisonAnalysis.results.zf - results.zf > 0 ? '+' : '') +
                              (comparisonAnalysis.results.zf - results.zf).toFixed(4)
                            : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {comparisonAnalysis.results.npo_aligned && !results?.npo_aligned && (
                  <div className="bg-green-100 border border-green-300 rounded-lg p-3 text-green-800">
                    <strong>Success!</strong> The re-run with suggested dpo produces results that align with the visual particle count.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
