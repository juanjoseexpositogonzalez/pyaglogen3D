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
import { type Column } from '@/components/kit/DataTable'
import { DetailList, type DetailItem } from '@/components/kit/DetailList'
import { EmptyState } from '@/components/kit/EmptyState'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { ShowValues } from '@/components/kit/ShowValues'
import { StatusChip } from '@/components/kit/StatusChip'
import { VisualPanel, type Readout } from '@/components/kit/VisualPanel'
import { FractalPlot } from '@/components/charts'
import { BoxCountingAnalysis, LimitingCasesCard, LIMITING_CASES, OpticalPropertiesSection } from '@/components/analysis'
import type { LimitingCaseLine } from '@/components/charts/FractalPlot'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, BarChart3, Download, StopCircle, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'
import { getScaleFactorNm, getSchemaVersion } from '@/lib/units'
import { simulationAlgorithmLabels } from '@/lib/simulation-algorithms'
import { UnitConventionBanner } from '@/components/banners/UnitConventionBanner'
import { useAuth } from '@/contexts/AuthContext'

/**
 * One particle exactly as the stage draws it: the deposition index, the
 * position and the radius. All three lengths are already in nanometres by the
 * time a row is built, so the table and the canvas cannot disagree about units.
 */
interface ParticleRow {
  n: number
  x: number
  y: number
  z: number
  radius: number | null
}

/**
 * The values behind the 3D visualisation, in the same order the viewer draws
 * them. Positions get one decimal in nm, which is the precision the scaled
 * geometry carries; more would be invented digits.
 */
const PARTICLE_COLUMNS: Column<ParticleRow>[] = [
  { key: 'n', header: '#', numeric: true, digits: 0, value: (row) => row.n },
  { key: 'x', header: 'x', numeric: true, unit: 'nm', digits: 1, value: (row) => row.x },
  { key: 'y', header: 'y', numeric: true, unit: 'nm', digits: 1, value: (row) => row.y },
  { key: 'z', header: 'z', numeric: true, unit: 'nm', digits: 1, value: (row) => row.z },
  { key: 'radius', header: 'radius', numeric: true, unit: 'nm', digits: 1, value: (row) => row.radius },
]

/**
 * How many particle rows the table paints. The serializer accepts up to
 * 100,000 particles, and a table of that size stalls the page; a bounded head
 * is honest as long as the caption says it is one.
 */
const PARTICLE_ROW_LIMIT = 500

/** The stage's height, in px. */
const STAGE_HEIGHT = 600

/**
 * Room left under the table for `VisualPanel`'s readings bar: the bar is about
 * 35px tall and sits 12px off the bottom edge, so 52px covers it with a few px
 * to spare. The table's cap must stay *below* the stage height — equal values
 * scroll the last row under the bar — and the gap also keeps the bar over the
 * dark canvas, which is the contrast its readings are toned for.
 */
const READINGS_BAR_CLEARANCE = 52

/**
 * What the table is, said once: the caption is all a reader has once the canvas
 * is gone, so it may not imply more rows than the table paints.
 */
const particleCaption = (shown: number, total: number): string =>
  shown < total
    ? `First ${shown} of ${total} particles: position and radius in nm, scaled with the record's particle diameter.`
    : "Particles behind this view: position and radius in nm, scaled with the record's particle diameter."

/**
 * The radius the scaling plot normalises by. The record's Rg arrives in the
 * same dimensionless units the engine reports, so 1.0 leaves Rg/rp equal to Rg:
 * the chart's horizontal axis and the table's column describe the same number.
 */
const PRIMARY_PARTICLE_RADIUS = 1.0

/**
 * The floor the scaling plot applies before it takes a logarithm. A ratio below
 * it never reaches the chart, so it must not reach the table either — a row the
 * plot does not draw is a row the reader cannot check against it.
 */
const MIN_RG_RP = 0.1

/** Room for the scaling table's own scroll region, in px. */
const SCALING_TABLE_MAX_HEIGHT = 340

/**
 * How tall the stage is under a visual that has not been rewritten onto the kit
 * yet.
 *
 * `VisualPanel` clips what overflows it, and those viewers still paint their own
 * card at their own height — a preview plus a 300px hemisphere, a four-stat
 * banner plus a 400px canvas plus the node panel a click opens. The frame gets a
 * bounded height and the card scrolls inside it, so a mis-measured window costs
 * a scrollbar instead of a control a reader can no longer reach.
 */
const PROJECTION_STAGE_HEIGHT = 620
const TOPOLOGY_STAGE_HEIGHT = 640

/** One point of the scaling plot, as the table behind it reads it. */
interface ScalingRow {
  n: number
  rgRp: number
}

/**
 * The points the scaling plot draws: the count it puts on its vertical axis and
 * the Rg/rp it puts on its horizontal one.
 *
 * There is deliberately no fitted column. The line on screen is the chart's own
 * log-log regression over the points its exclusion sliders leave in, and those
 * sliders are chart state this page cannot read. A column computed here — from
 * the record's Df and kf, or from a second regression over these rows — would
 * contradict the line the reader is looking at, and a header may not call itself
 * "fit" when it is not the fit that is drawn.
 */
const SCALING_COLUMNS: Column<ScalingRow>[] = [
  { key: 'n', header: 'N', numeric: true, digits: 0, value: (row) => row.n },
  { key: 'rgRp', header: 'Rg/rp', numeric: true, digits: 3, value: (row) => row.rgRp },
]

/** What the scaling table is: exactly the series the chart was handed. */
const SCALING_CAPTION =
  'Sampled Rg points the scaling plot draws: the particle count of each sample and the Rg/rp it puts on the horizontal axis.'

/**
 * The pairs `FractalPlot` draws. The page derives them because the page owns the
 * table of them: the plot samples `rg_evolution` at a step of
 * totalParticles / length and drops ratios under 0.1 so its log axis stays
 * finite. Mirroring that sampling here keeps the table's N in step with the axis
 * and its rows equal to the points on screen.
 */
const scalingRows = (
  rgEvolution: number[],
  totalParticles: number | undefined,
): ScalingRow[] => {
  const step =
    totalParticles && rgEvolution.length > 0
      ? Math.round(totalParticles / rgEvolution.length)
      : 1

  const rows: ScalingRow[] = []
  rgEvolution.forEach((rg, index) => {
    const rgRp = rg / PRIMARY_PARTICLE_RADIUS
    if (rgRp < MIN_RG_RP) return
    rows.push({ n: (index + 1) * step, rgRp })
  })
  return rows
}

/** How the anisotropy reads in words: the thresholds this page has always used. */
const anisotropyVerdict = (anisotropy: number): string =>
  anisotropy < 1.5 ? 'Compact' : anisotropy < 3 ? 'Moderate' : 'Elongated'

/**
 * One recorded parameter as a detail row.
 *
 * The wire key is the only label the record carries, so underscores read as
 * spaces. Nested dicts (`import_metadata` and the like) are JSON-encoded, which
 * is the only rendering that does not collapse into "[object Object]".
 */
const parameterItem = ([key, value]: [string, unknown]): DetailItem => {
  const label = key.replace(/_/g, ' ')
  if (typeof value === 'number') {
    return { label, value, digits: parameterDigits(value) }
  }
  if (value === null || value === undefined) return { label, value: null }
  // A nested dict renders as JSON and a filename arrives as one unbroken token.
  // Both are wrapped here, on the page, because neither fits a 20-character
  // column and `DetailList` owes every caller the same list, not this fix.
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return { label, value: <span className="break-words">{text}</span> }
}

/**
 * How many decimals a recorded parameter is written with: as many as the value
 * carries, never a fixed fill.
 *
 * `1.8` gets one decimal because that is what the record holds; printing `1.800`
 * would invent two digits the run never had. The cap only bites float artefacts
 * such as 0.30000000000000004, where the digits past the sixth describe the
 * double rather than the parameter.
 */
const parameterDigits = (value: number): number => {
  if (Number.isInteger(value)) return 0
  return Math.min(String(value).split('.')[1]?.length ?? 0, 6)
}

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
  const {
    data: geometry,
    isLoading: isGeometryLoading,
    isError: isGeometryError,
  } = useSimulationGeometry(simId, simulation?.status === 'completed')
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
    // A load that failed is a state, and states on this page are callouts: the
    // same notice the run's own failure uses, so a reader does not have to
    // learn a second vocabulary for "this record is not available".
    return (
      <Callout tone="danger" title="Failed to load simulation">
        It may not exist, or the backend is unavailable.
      </Callout>
    )
  }

  // Scale factor (nm per dimensionless engine unit) resolved via the shim.
  // Handles v1 (primary_particle_radius_nm) and v2 (primary_particle_diameter_nm)
  // schemas uniformly, with a default of 25.0 nm when neither key is present.
  const scaleFactor = getScaleFactorNm(
    // SAFETY: `parameters` is a JSON object on the wire (the serializer emits a
    // dict), but the type system only knows the narrow per-algorithm shape. The
    // unit helpers read arbitrary keys and validate them at runtime, so the
    // widening is a fact about the payload, not an assumption about a field.
    (simulation?.parameters ?? {}) as unknown as Record<string, unknown>,
  )

  // Scale coordinates and radii for display
  const coordinates = (geometry?.coordinates ?? []).map(([x, y, z]) => [
    x * scaleFactor,
    y * scaleFactor,
    z * scaleFactor,
  ])
  const radii = (geometry?.radii ?? []).map((r) => r * scaleFactor)

  // A run with no geometry has nothing to draw and nothing to tabulate. Saying
  // that once here keeps the stage and the toggle from disagreeing.
  const hasParticles = coordinates.length > 0

  /**
   * The same particles the canvas is drawing, one row each. The radius is read
   * from the same scaled array the viewer gets, so a geometry payload that
   * ships fewer radii than positions reads as missing, not as zero.
   */
  const particleRows: ParticleRow[] = coordinates.slice(0, PARTICLE_ROW_LIMIT).map(([x, y, z], index) => ({
    n: index + 1,
    x,
    y,
    z,
    radius: radii[index] ?? null,
  }))

  // The stage's body is rendered from a callback, and TypeScript stops
  // narrowing a property access once a function boundary is crossed. Reading
  // the axes here keeps that proof in one place instead of optional-chaining
  // the same value at the call site.
  const principalAxes = simulation.metrics?.principal_axes

  /**
   * The caption bar repeats two numbers the page already has — how many
   * particles the geometry holds and the record's Rg in nm — so the readings
   * sit on the surface they describe. Nothing is recomputed for them, and the
   * count says where it comes from: the header counts the record's
   * `n_particles`, which is not the same number when the payload is short.
   */
  const visualReadouts: Readout[] | undefined =
    hasParticles && simulation.metrics
      ? [
          {
            label: 'in geometry',
            value: <Num value={coordinates.length} digits={0} size="sm" onDark />,
          },
          {
            label: 'Rg',
            value: (
              <Num
                value={simulation.metrics.radius_of_gyration * scaleFactor}
                unit="nm"
                digits={1}
                size="sm"
                onDark
              />
            ),
          },
        ]
      : undefined

  /**
   * The scaling series behind the plot, or null when the record cannot support
   * one. Imported agglomerates ship no `rg_evolution` and may carry a null Df
   * when N < 50, so all three readings are required before either the chart or
   * its table is offered.
   */
  const scaling =
    simulation.metrics &&
    simulation.metrics.rg_evolution &&
    simulation.metrics.rg_evolution.length > 0 &&
    simulation.metrics.fractal_dimension !== null &&
    simulation.metrics.prefactor !== undefined
      ? {
          rgEvolution: simulation.metrics.rg_evolution,
          fractalDimension: simulation.metrics.fractal_dimension,
          prefactor: simulation.metrics.prefactor,
          rows: scalingRows(simulation.metrics.rg_evolution, npo),
        }
      : null

  /**
   * The coordination readings as label/value rows. Both are what the engine
   * measured over the contact network; an absent record renders the em dash
   * `Num` owes a missing number instead of a card that claims zero contacts.
   */
  const coordinationItems: DetailItem[] = simulation.metrics
    ? [
        { label: 'Mean', value: simulation.metrics.coordination.mean, digits: 2 },
        { label: 'Std. dev.', value: simulation.metrics.coordination.std, digits: 2 },
      ]
    : []

  /**
   * The shape readings from the inertia tensor. A legacy payload without an
   * anisotropy keeps the panel hidden, which is what the card did. The verdict
   * stays in words beside the number: a form stated as 1.20 alone is a number
   * the reader has to interpret.
   */
  const shapeItems: DetailItem[] =
    simulation.metrics && simulation.metrics.anisotropy !== undefined
      ? [
          {
            label: 'Anisotropy',
            value: (
              <>
                <Num value={simulation.metrics.anisotropy} digits={2} size="sm" />
                <span className="hint ml-1.5">
                  {anisotropyVerdict(simulation.metrics.anisotropy)}
                </span>
              </>
            ),
          },
          { label: 'Asphericity', value: simulation.metrics.asphericity, digits: 3 },
          { label: 'Acylindricity', value: simulation.metrics.acylindricity, digits: 3 },
          ...(simulation.metrics.principal_moments
            ? [
                {
                  label: 'Principal moment I\u2081 (min)',
                  value: simulation.metrics.principal_moments[0],
                  digits: 1,
                },
                {
                  label: 'Principal moment I\u2082',
                  value: simulation.metrics.principal_moments[1],
                  digits: 1,
                },
                {
                  label: 'Principal moment I\u2083 (max)',
                  value: simulation.metrics.principal_moments[2],
                  digits: 1,
                },
              ]
            : []),
        ]
      : []

  /** Every recorded parameter, in the order the wire sends them. */
  const parameterItems: DetailItem[] = Object.entries(simulation.parameters).map(parameterItem)

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
        // SAFETY: same payload fact as above — the schema detector probes keys
        // that the narrow `SimulationParams` type does not enumerate.
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
        title={
          simulation.name?.trim() ||
          // The generated name is usually present; when it is not, the wire
          // token (`tunable_cc`) is not a product name. The label map is the
          // same one the create form shows.
          (simulationAlgorithmLabels[simulation.algorithm] ??
            simulation.algorithm.toUpperCase())
        }
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
              <span>
                <Num value={npo} digits={0} size="sm" /> particles
              </span>
            )}
            {/* A queued run has not been timed yet: the duration is absent, not
                zero, because "took no time" is a different claim. It keeps its
                word — a bare "1.20 s" between two labelled items reads as a
                number nobody named. */}
            {simulation.execution_time_ms ? (
              <span>
                elapsed{' '}
                <Num value={simulation.execution_time_ms / 1000} digits={2} size="sm" unit="s" />
              </span>
            ) : null}
            <span>
              seed <Num value={simulation.seed} digits={0} size="sm" />
            </span>
            <span>{formatDistanceToNow(simulation.created_at)}</span>
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
              detail={
                simulation.metrics.fractal_dimension === null
                  ? simulation.metrics.notes?.fractal_dimension ??
                    'Not measured for this record'
                  : "Fit slope of Rg versus particle count · the ± is the engine's own estimate, not a fit error"
              }
            />
            <MetricCard
              kind="measured"
              tone="violet"
              label="Radius of gyration"
              value={simulation.metrics.radius_of_gyration * scaleFactor}
              sigma={null}
              digits={1}
              unit="nm"
              detail="Scaled to nm with the record's particle diameter (50 nm when it is absent)"
            />
            <MetricCard
              kind="measured"
              tone="gold"
              label="Porosity"
              value={simulation.metrics.porosity * 100}
              sigma={null}
              digits={1}
              unit="%"
              detail="Empty fraction of the enclosing sphere; the importer bounds it differently"
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

            {/* Coordination and shape readings. Both are label/value pairs
                the engine reported, so both go through `DetailList`: label
                left, reading right, and the digits each has always carried. */}
            <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
              <Panel title="Coordination number">
                <DetailList items={coordinationItems} />
              </Panel>

              {shapeItems.length > 0 && (
                <Panel
                  title="Shape analysis"
                  hint="Read from the inertia tensor: how far the aggregate departs from a sphere."
                >
                  <DetailList items={shapeItems} />
                </Panel>
              )}
            </div>

            {/* Fractal scaling plot. `ShowValues` hands back the control and
                the table so the page can put the toggle in the panel header and
                let the table take the chart's place, keeping the title, the
                hint and the frame where a reader left them. */}
            {scaling && (
              <div className="mb-8">
                <ShowValues
                  columns={SCALING_COLUMNS}
                  rows={scaling.rows}
                  caption={SCALING_CAPTION}
                  maxHeight={SCALING_TABLE_MAX_HEIGHT}
                >
                  {({ toggle, table }) => (
                    <Panel
                      title="Fractal scaling"
                      hint="Radius of gyration against particle count on log axes, with the power law fitted to this run."
                      action={toggle}
                    >
                      {/*
                        The chart stays mounted and is hidden while the table
                        shows. Unmounting it throws away the exclusion sliders,
                        the plot background and the legend, so a reader who
                        excludes points, looks at the numbers and comes back
                        would meet a different fit without being told.
                      */}
                      <div className={table ? 'hidden' : undefined}>
                        <FractalPlot
                          rgEvolution={scaling.rgEvolution}
                          fractalDimension={scaling.fractalDimension}
                          prefactor={scaling.prefactor}
                          primaryParticleRadius={PRIMARY_PARTICLE_RADIUS}
                          totalParticles={npo}
                          limitingCases={limitingCaseLines}
                        />
                      </div>
                      {table}
                    </Panel>
                  )}
                </ShowValues>
              </div>
            )}

            {/* Fractal analysis: box counting, and the canonical cases the
                scaling plot can overlay. The limiting cases stay open on the
                page instead of inside a disclosure because they carry the
                switch that draws their lines: a collapsed block would hide the
                control as well as the reference table. */}
            <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* No panel title: these three blocks carry their own card header,
                  and a kit heading above it would stack two names a few pixels
                  apart. The page only frames them. */}
              <Panel>
                <BoxCountingAnalysis projectId={id} simulationId={simId} />
              </Panel>

              {'n_particles' in simulation.parameters && (
                <Panel>
                  <LimitingCasesCard
                    npo={(simulation.parameters as { n_particles: number }).n_particles}
                    actualDf={simulation.metrics.fractal_dimension}
                    actualKf={simulation.metrics.prefactor}
                    onVisibilityChange={setShowLimitingCases}
                  />
                </Panel>
              )}
            </div>

            {/* 3D Viewer */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
              <div className="lg:col-span-3">
                {/*
                  `ShowValues` hands over the toggle and the table so this page
                  can place them inside its own frame: the toggle goes in the
                  panel header and the table takes the canvas's place, which
                  leaves the title, the caption bar and the border where a
                  reader left them. The page configures the table and never
                  assembles one.
                */}
                <ShowValues
                  columns={PARTICLE_COLUMNS}
                  rows={particleRows}
                  caption={particleCaption(particleRows.length, coordinates.length)}
                  maxHeight={STAGE_HEIGHT - READINGS_BAR_CLEARANCE}
                >
                  {({ toggle, table }) => (
                    <VisualPanel
                      title="3D visualization"
                      readouts={visualReadouts}
                      action={hasParticles ? toggle : undefined}
                      height={STAGE_HEIGHT}
                    >
                      {isGeometryError ? (
                        // The request failed; the run may be fine. Saying
                        // "nothing to draw" would blame the record for a
                        // transport error.
                        <div className="flex h-full items-center justify-center bg-surface-strong px-6">
                          <Callout
                            tone="danger"
                            title="Particle positions could not be loaded"
                            className="w-full max-w-[46ch]"
                          >
                            The canvas draws what the engine wrote for this run, and that record
                            could not be read. Reload the page to ask again.
                          </Callout>
                        </div>
                      ) : isGeometryLoading ? (
                        // In flight is not missing: same distinction, one state
                        // earlier.
                        <div className="flex h-full items-center justify-center bg-surface-strong px-6">
                          <p className="hint m-0">Reading particle positions…</p>
                        </div>
                      ) : !hasParticles ? (
                        // An empty canvas reads as a broken renderer. The stage
                        // says what it is waiting for instead.
                        <div className="flex h-full items-center justify-center bg-surface-strong px-6">
                          <EmptyState
                            headingLevel={3}
                            title="Nothing to draw yet"
                            description="The 3D view appears once the engine returns the particle positions for this run."
                            className="max-w-[46ch]"
                          />
                        </div>
                      ) : table ? (
                        // Paper under the table. `DataTable` paints cells in
                        // `--ink` and its caption in `--ink-muted`, which over
                        // the stage measured 1.29:1 and 3.3:1; on the strong
                        // surface they measure 14.4:1 and 5.7:1 in the light
                        // theme, and the dark theme flips both tokens together.
                        <div className="bg-surface-strong">{table}</div>
                      ) : (
                        <AgglomerateViewer
                          coordinates={coordinates}
                          radii={radii}
                          principalAxes={principalAxes}
                          className="h-[600px]"
                        />
                      )}
                    </VisualPanel>
                  )}
                </ShowValues>
              </div>
              <div className="lg:col-span-1">
                <ViewerControls
                  onExportCsv={handleExportCsv}
                  isExportingCsv={isExporting}
                />
              </div>
            </div>

            {/* 2D projections. A projection is a view of the object, so it
                sits on the dark stage; the controls that generate it and
                download it keep their own column and their own behaviour. */}
            <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-4">
              <div className="lg:col-span-3">
                {/* No title: the viewer names itself ("Preview (Az…, El…)").
                    The stage adds the frame, and the region label below is what
                    names it for a screen reader. */}
                <VisualPanel height={PROJECTION_STAGE_HEIGHT}>
                  {/*
                    Paper under the legacy card. Its own `bg-card/70` over the
                    stage (#07141d) composites to #b5b9bb, where its
                    `--muted-foreground` measures 2.78:1 in the light theme —
                    under AA, on the labels a reader needs in order to use the
                    controls. On `--surface-strong` the same text measures 5.52:1
                    (light) and 8.01:1 (dark), which is the remedy slice 2
                    applied to the particle table.

                    `role`/`tabIndex` matter as much: the card inside is taller
                    than the stage, and a scroll box with no focusable content
                    cannot be reached by keyboard.
                  */}
                  <div
                    role="region"
                    aria-label="2D projection preview"
                    tabIndex={0}
                    className="h-full overflow-y-auto bg-surface-strong"
                  >
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
                </VisualPanel>
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

            {/* Topology. A graph is a view of the object too: same stage,
                same frame. */}
            <div className="mb-8">
              {/* Same frame, same paper and same keyboard contract as the
                  projection stage: the graph names itself, and its node panel
                  scrolls. */}
              <VisualPanel height={TOPOLOGY_STAGE_HEIGHT}>
                <div
                  role="region"
                  aria-label="Topology graph"
                  tabIndex={0}
                  className="h-full overflow-y-auto bg-surface-strong"
                >
                  <NeighborGraph data={neighborGraph ?? null} isLoading={isGraphLoading} />
                </div>
              </VisualPanel>
            </div>

            {/* Optical properties */}
            <div className="mb-8">
              <Panel>
                <OpticalPropertiesSection
                  projectId={id}
                  simulationId={simId}
                  existingOptical={simulation.metrics.optical}
                />
              </Panel>
            </div>

            {/* What the run was asked for. `DetailList` is the product's
                parameter recap, so every value keeps its label on the left and
                a number goes through `Num`. */}
            <Panel
              title="Simulation parameters"
              hint="Exactly what this run was asked for, key by key."
            >
              <DetailList items={parameterItems} />
            </Panel>

          </>
        )}
    </>
  )
}
