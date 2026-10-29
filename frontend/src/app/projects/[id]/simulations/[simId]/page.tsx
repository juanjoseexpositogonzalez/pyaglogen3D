'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProject } from '@/hooks/useProjects'
import { useSimulation, useSimulationGeometry, useNeighborGraph } from '@/hooks/useSimulations'
import { ApiError, simulationsApi } from '@/lib/api'
import { AgglomerateViewer } from '@/components/viewer3d/AgglomerateViewer'
import { ViewerControls } from '@/components/viewer3d/ViewerControls'
import {
  ProjectionControls,
  ProjectionViewer,
  type ProjectionParams,
  type BatchParams,
  type ExportProgress,
  type ProjectionMode,
  type ModeChangeConfig,
} from '@/components/projection'
import type { ExportProjectionsPayload } from '@/lib/api'
import {
  computeGridDirections,
  modeConfigToGridConfig,
  deriveGeneratedDirections,
} from '@/lib/projection-grid'
import { NeighborGraph } from '@/components/topology'
import { Callout } from '@/components/kit/Callout'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { StatusChip } from '@/components/kit/StatusChip'
import { FractalPlot } from '@/components/charts'
import { BoxCountingAnalysis, LimitingCasesCard, LIMITING_CASES, OpticalPropertiesSection } from '@/components/analysis'
import type { LimitingCaseLine } from '@/components/charts/FractalPlot'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, BarChart3, Download, StopCircle, Trash2 } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import { getScaleFactorNm, getSchemaVersion } from '@/lib/units'
import { UnitConventionBanner } from '@/components/banners/UnitConventionBanner'
import { useAuth } from '@/contexts/AuthContext'

export default function SimulationDetailPage({
  params,
}: {
  params: { id: string; simId: string }
}) {
  const { id, simId } = params
  const router = useRouter()
  const { user } = useAuth()
  const { data: project } = useProject(id)
  const { data: simulation, isLoading, error, refetch } = useSimulation(id, simId)
  const { data: geometry } = useSimulationGeometry(
    simId,
    simulation?.status === 'completed'
  )
  const { data: neighborGraph, isLoading: isGraphLoading } = useNeighborGraph(
    id,
    simId,
    simulation?.status === 'completed'
  )

  const [isCancelling, setIsCancelling] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Projection state
  const [projectionUrl, setProjectionUrl] = useState<string | null>(null)
  const [projectionParams, setProjectionParams] = useState<ProjectionParams>({
    azimuth: 45,
    elevation: 30,
    format: 'png',
  })
  const [isProjectionLoading, setIsProjectionLoading] = useState(false)
  const [isBatchLoading, setIsBatchLoading] = useState(false)
  const [batchDownloadError, setBatchDownloadError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [showLimitingCases, setShowLimitingCases] = useState(false)

  // Hemisphere viz state — driven by ProjectionControls.onModeChange
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('grid')
  const [projectionModeConfig, setProjectionModeConfig] = useState<ModeChangeConfig>({ n_az: 10, n_el: 5 })
  const [generatedDirections, setGeneratedDirections] = useState<
    Array<{ az: number; el: number; projectionId: string }>
  >([])

  // Compute grid directions for the hemisphere (recalculates when mode/config change)
  const gridDirections = useMemo(
    () => computeGridDirections(projectionMode, modeConfigToGridConfig(projectionMode, projectionModeConfig)),
    [projectionMode, projectionModeConfig],
  )

  const handleModeChange = (mode: ProjectionMode, config: ModeChangeConfig) => {
    setProjectionMode(mode)
    setProjectionModeConfig(config)
    // Reset generated directions when config changes — the old export
    // no longer matches the new grid.
    setGeneratedDirections([])
  }

  // Generate limiting case lines for the fractal plot when checkbox is checked
  // This must be before any early returns to follow React's rules of hooks
  const npo = simulation && 'n_particles' in simulation.parameters
    ? (simulation.parameters as { n_particles: number }).n_particles
    : undefined
  const limitingCaseLines: LimitingCaseLine[] | undefined = useMemo(() => {
    if (!showLimitingCases || !npo) return undefined
    return LIMITING_CASES.map((lc) => ({
      name: lc.name,
      df: lc.df,
      kf: lc.kfFormula(npo),
      color: lc.color,
      rgRpFormula: lc.rgRpFormula,
    }))
  }, [showLimitingCases, npo])

  const handleExportCsv = async () => {
    setIsExporting(true)
    try {
      const blob = await simulationsApi.exportCsv(id, simId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${simId}_export.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export CSV:', err)
    } finally {
      setIsExporting(false)
    }
  }

  const handleProjectionPreview = async (params: ProjectionParams) => {
    setIsProjectionLoading(true)
    setProjectionParams(params)
    try {
      const blob = await simulationsApi.getProjection(id, simId, params)
      // Revoke previous URL to avoid memory leaks
      if (projectionUrl) {
        URL.revokeObjectURL(projectionUrl)
      }
      const url = URL.createObjectURL(blob)
      setProjectionUrl(url)
    } catch (err) {
      console.error('Failed to generate projection:', err)
    } finally {
      setIsProjectionLoading(false)
    }
  }

  const handleDirectionClick = (
    direction: { az: number; el: number; projectionId: string },
  ) => {
    handleProjectionPreview({
      azimuth: direction.az,
      elevation: direction.el,
      format: projectionParams.format,
    })
  }

  const handleBatchDownload = async (params: BatchParams) => {
    setIsBatchLoading(true)
    setBatchDownloadError(null)
    try {
      const blob = await simulationsApi.getProjectionBatch(id, simId, params)
      // Trigger download
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${simId}_projections.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to generate batch projections:', err)
      setBatchDownloadError(
        err instanceof ApiError
          ? err.message
          : 'Failed to generate projections ZIP. Verify the selected angles and try again.'
      )
    } finally {
      setIsBatchLoading(false)
    }
  }

  // Mode-aware export handler for grid / fibonacci / legacy (post frente-4).
  // Passes onProgress through so the dialog can render the polling bar.
  const handleExportProjections = async (
    payload: ExportProjectionsPayload,
    onProgress?: (p: ExportProgress) => void,
  ) => {
    setIsBatchLoading(true)
    setBatchDownloadError(null)
    try {
      const blob = await simulationsApi.exportProjections(
        id,
        simId,
        payload,
        {
          onProgress: (progress, current, total) => {
            onProgress?.({ progress, current, total })
          },
        },
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const suffix =
        payload.mode === 'grid'
          ? 'grid'
          : payload.mode === 'fibonacci'
            ? 'fibonacci'
            : 'projections'
      link.download = `${simId}_${suffix}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      // Populate hemisphere viz with the directions that were just generated
      setGeneratedDirections(deriveGeneratedDirections(payload))
    } catch (err) {
      console.error('Failed to export projections:', err)
      setBatchDownloadError(
        err instanceof ApiError
          ? err.message
          : 'Failed to generate projections ZIP. Verify the selected parameters and try again.',
      )
    } finally {
      setIsBatchLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!simulation) return
    setIsCancelling(true)
    try {
      await simulationsApi.cancel(id, simId)
      refetch()
    } catch (err) {
      console.error('Failed to cancel simulation:', err)
    } finally {
      setIsCancelling(false)
    }
  }

  const handleDelete = async () => {
    if (!simulation) return
    setIsDeleting(true)
    try {
      await simulationsApi.delete(id, simId)
      router.push(`/projects/${id}`)
    } catch (err) {
      console.error('Failed to delete simulation:', err)
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (isLoading) {
    // The shell owns the frame and the navigation; this branch only says what
    // is happening.
    return <LoadingScreen message="Loading simulation..." />
  }

  if (error || !simulation) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-6">
          <p className="text-destructive">
            Failed to load simulation. It may not exist or the backend is unavailable.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Scale factor (nm per dimensionless engine unit) resolved via the shim.
  // Handles v1 (primary_particle_radius_nm) and v2 (primary_particle_diameter_nm)
  // schemas uniformly, with a default of 25.0 nm when neither key is present.
  const scaleFactor = getScaleFactorNm(
    (simulation?.parameters ?? {}) as unknown as Record<string, unknown>,
  )

  // Scale coordinates and radii for display
  const coordinates = (geometry?.coordinates ?? []).map(([x, y, z]) => [
    x * scaleFactor,
    y * scaleFactor,
    z * scaleFactor,
  ])
  const radii = (geometry?.radii ?? []).map((r) => r * scaleFactor)

  return (
    <>
      {/* Breadcrumb */}
      <Link
        href={`/projects/${id}`}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {project?.name || 'Project'}
      </Link>

      {/* Unit convention transition banner — shown only for legacy (v1/null) simulations */}
      {(() => {
        const schemaVersion = getSchemaVersion(
          (simulation?.parameters ?? {}) as unknown as Record<string, unknown>,
        )
        if (schemaVersion === 'v2') return null
        return (
          <UnitConventionBanner
            simulationId={simId}
            schemaVersion={schemaVersion}
            userId={user?.id ?? 'anonymous'}
          />
        )
      })()}

      <PageHeader
        eyebrow="SIMULATION"
        title={simulation.name?.trim() || simulation.algorithm.toUpperCase()}
        /*
          Reproducibility goes under the title, before any reading: which
          algorithm produced this, from how many particles, with which seed,
          and how long it took. Every number goes through `Num`, so the count
          reads 1,200 and the seed and the duration line up with the rest of
          the product.
        */
        meta={
          <>
            <StatusChip status={simulation.status} />
            <span>{simulation.algorithm.toUpperCase()}</span>
            {npo !== undefined && (
              <span className="inline-flex items-baseline gap-1">
                <Num value={npo} digits={0} size="sm" />
                <span>particles</span>
              </span>
            )}
            {/* A queued run has not been timed yet; an em dash here would read
                as "took no time", which is a different claim. */}
            {simulation.execution_time_ms ? (
              <Num value={simulation.execution_time_ms / 1000} digits={2} size="sm" unit="s" />
            ) : null}
            <span className="inline-flex items-baseline gap-1">
              <span>seed</span>
              <Num value={simulation.seed} digits={0} size="sm" />
            </span>
          </>
        }
        actions={
          <>
            {simulation.status === 'completed' && (
              <Button
                variant="outline"
                onClick={handleExportCsv}
                disabled={isExporting}
              >
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            )}
            {/* Frente 9 P5: sim → batch FRAKTAL entry point. Pre-fills the
                upload form via query params so autocalibrate defaults to
                OFF with the known dpo from this simulation. */}
            {simulation.status === 'completed' && (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(
                    `/projects/${id}/fraktal/batch?origin=simulation&sim_id=${simId}`,
                  )
                }
                aria-label="Analyze projections with FRAKTAL"
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Analyze projections
              </Button>
            )}
            {showDeleteConfirm ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-muted">Delete?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Confirm'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </>
        }
      />

      {/* Running State */}
      {(simulation.status === 'queued' || simulation.status === 'running') && (
        <Callout
          className="mb-6"
          title={simulation.status === 'queued' ? 'Simulation queued' : 'Simulation running'}
          action={
            <Button variant="outline" onClick={handleCancel} disabled={isCancelling}>
              <StopCircle className="h-4 w-4 mr-2" />
              {isCancelling ? 'Cancelling...' : 'Cancel simulation'}
            </Button>
          }
        >
          {simulation.status === 'queued'
            ? 'Your simulation is in the queue and will start shortly...'
            : 'Generating agglomerate structure... This page will update automatically.'}
        </Callout>
      )}

      {/* Cancelled State */}
      {simulation.status === 'cancelled' && (
        <Callout className="mb-6" tone="warning" title="Simulation cancelled">
          {simulation.error_message || 'This simulation was cancelled.'}
        </Callout>
      )}

      {/* Failed State */}
      {simulation.status === 'failed' && (
        <Callout className="mb-6" tone="danger" title="Simulation failed">
          {simulation.error_message || 'An unknown error occurred during simulation.'}
        </Callout>
      )}

      {/* Completed State */}
      {simulation.status === 'completed' && simulation.metrics && (
        <>
          {/*
            The headline readings. Each one goes through a metric card so the
            value, its unit and its uncertainty are separate elements and the
            digits stay the ones this page has always printed: Df and kf to
            three, Rg in nm and porosity as a percentage to one.
          */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              kind="measured"
              tone="teal"
              label="Fractal dimension"
              value={simulation.metrics.fractal_dimension}
              sigma={simulation.metrics.fractal_dimension_std}
              digits={3}
              detail="Fit slope, ± its standard error"
            />
            <MetricCard
              kind="measured"
              tone="violet"
              label="Radius of gyration"
              value={simulation.metrics.radius_of_gyration * scaleFactor}
              sigma={null}
              digits={1}
              unit="nm"
              detail="Converted to nm with the primary particle diameter"
            />
            <MetricCard
              kind="measured"
              tone="gold"
              label="Porosity"
              value={simulation.metrics.porosity * 100}
              sigma={null}
              digits={1}
              unit="%"
              detail="Empty share of the enclosing volume"
            />
            <MetricCard
              kind="measured"
              tone="slate"
              label="Prefactor (kf)"
              value={simulation.metrics.prefactor ?? null}
              sigma={null}
              digits={3}
              detail="Scale factor of the same power law"
            />
          </div>

            {/* Coordination and Shape Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Coordination Number</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-8">
                    <div>
                      <p className="text-sm text-muted-foreground">Mean</p>
                      <p className="text-2xl font-bold">
                        {formatNumber(simulation.metrics.coordination.mean, 2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Std. Dev.</p>
                      <p className="text-2xl font-bold">
                        {formatNumber(simulation.metrics.coordination.std, 2)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Shape Analysis from Inertia Tensor */}
              {simulation.metrics.anisotropy !== undefined && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Shape Analysis</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-8">
                      <div>
                        <p className="text-sm text-muted-foreground">Anisotropy</p>
                        <p className="text-2xl font-bold">
                          {formatNumber(simulation.metrics.anisotropy, 2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {simulation.metrics.anisotropy < 1.5 ? 'Compact' :
                           simulation.metrics.anisotropy < 3 ? 'Moderate' : 'Elongated'}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Asphericity</p>
                        <p className="text-2xl font-bold">
                          {formatNumber(simulation.metrics.asphericity, 3)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Acylindricity</p>
                        <p className="text-2xl font-bold">
                          {formatNumber(simulation.metrics.acylindricity, 3)}
                        </p>
                      </div>
                    </div>
                    {/* Principal Moments of Inertia */}
                    {simulation.metrics.principal_moments && (
                      <div className="pt-2 border-t">
                        <p className="text-sm text-muted-foreground mb-2">Principal Moments of Inertia</p>
                        <div className="flex gap-6">
                          <div>
                            <p className="text-xs text-muted-foreground">I₁ (min)</p>
                            <p className="text-lg font-mono font-medium">
                              {formatNumber(simulation.metrics.principal_moments[0], 1)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">I₂</p>
                            <p className="text-lg font-mono font-medium">
                              {formatNumber(simulation.metrics.principal_moments[1], 1)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">I₃ (max)</p>
                            <p className="text-lg font-mono font-medium">
                              {formatNumber(simulation.metrics.principal_moments[2], 1)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Fractal Scaling Plot — requires rg_evolution AND computed Df/kf.
                Imported agglomerates don't ship rg_evolution and may have null
                Df when N < 50, so gate on all three being present. */}
            {simulation.metrics.rg_evolution &&
             simulation.metrics.rg_evolution.length > 0 &&
             simulation.metrics.fractal_dimension !== null &&
             simulation.metrics.prefactor !== undefined && (
              <div className="mb-8">
                <FractalPlot
                  rgEvolution={simulation.metrics.rg_evolution}
                  fractalDimension={simulation.metrics.fractal_dimension}
                  prefactor={simulation.metrics.prefactor}
                  primaryParticleRadius={1.0}
                  totalParticles={
                    'n_particles' in simulation.parameters
                      ? (simulation.parameters as { n_particles: number }).n_particles
                      : undefined
                  }
                  limitingCases={limitingCaseLines}
                />
              </div>
            )}

            {/* Fractal Analysis Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Box-Counting Analysis */}
              <BoxCountingAnalysis projectId={id} simulationId={simId} />

              {/* Limiting Cases for Calibration */}
              {'n_particles' in simulation.parameters && (
                <LimitingCasesCard
                  npo={(simulation.parameters as { n_particles: number }).n_particles}
                  actualDf={simulation.metrics.fractal_dimension}
                  actualKf={simulation.metrics.prefactor}
                  onVisibilityChange={setShowLimitingCases}
                />
              )}
            </div>

            {/* 3D Viewer */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
              <div className="lg:col-span-3">
                <Card>
                  <CardHeader>
                    <CardTitle>3D Visualization</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2">
                    <AgglomerateViewer
                      coordinates={coordinates}
                      radii={radii}
                      principalAxes={simulation.metrics.principal_axes}
                      className="h-[600px]"
                    />
                  </CardContent>
                </Card>
              </div>
              <div className="lg:col-span-1">
                <ViewerControls
                  onExportCsv={handleExportCsv}
                  isExportingCsv={isExporting}
                />
              </div>
            </div>

            {/* 2D Projections */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
              <div className="lg:col-span-3">
                <ProjectionViewer
                  imageUrl={projectionUrl}
                  azimuth={projectionParams.azimuth}
                  elevation={projectionParams.elevation}
                  format={projectionParams.format}
                  gridDirections={gridDirections}
                  generatedDirections={generatedDirections}
                  onDirectionClick={handleDirectionClick}
                />
              </div>
              <div className="lg:col-span-1">
                <div className="space-y-4">
                  {batchDownloadError && (
                    <Alert variant="destructive">
                      <AlertDescription>{batchDownloadError}</AlertDescription>
                    </Alert>
                  )}
                  <ProjectionControls
                    onPreview={handleProjectionPreview}
                    onExport={handleExportProjections}
                    onDownloadBatch={handleBatchDownload}
                    onModeChange={handleModeChange}
                    isLoading={isProjectionLoading}
                    isBatchLoading={isBatchLoading}
                  />
                </div>
              </div>
            </div>

            {/* Topology Analysis */}
            <div className="mb-8">
              <NeighborGraph
                data={neighborGraph ?? null}
                isLoading={isGraphLoading}
              />
            </div>

            {/* Optical Properties */}
            <div className="mb-8">
              <OpticalPropertiesSection
                projectId={id}
                simulationId={simId}
                existingOptical={simulation.metrics.optical}
              />
            </div>

            {/* Parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Simulation Parameters</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(simulation.parameters).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-sm text-muted-foreground">
                        {key.replace(/_/g, ' ')}
                      </dt>
                      <dd className="font-mono break-words">
                        {/* import_metadata etc. are nested dicts; JSON-encode
                            so they don't render as "[object Object]". */}
                        {value === null || value === undefined
                          ? '—'
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </>
        )}
    </>
  )
}
