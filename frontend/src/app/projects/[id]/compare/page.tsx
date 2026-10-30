'use client'

/**
 * Multi-aggregate Compare page — design-system kit, slice 1 (issue #175).
 *
 * Reads `?sims=<csv>` from the URL, fetches each simulation's metadata
 * and geometry in parallel, partitions results into
 * loaded / missing / unreachable / processing, and composes the compare UI:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ PageHeader — project name, counts, way back            │
 *   │ Truncation note (>9 sim ids)                           │
 *   │ Load-failure notice (the request did not come back)    │
 *   │ Missing-sim notice (404/403 answers)                   │
 *   │ Still-processing note (sim exists but no geometry yet) │
 *   │ Panel: CompareSettingsPanel (mode + sync toggles)      │
 *   │        CompareGrid  |  CompareOverlay                  │
 *   │ CompareMetricsTable            (slice 2)               │
 *   │ RgEvolutionChart               (slice 2)               │
 *   └────────────────────────────────────────────────────────┘
 *
 * The shell owns the page frame — `AppShell` mounts the navigation and the
 * single `<main>` — so this page returns a fragment.
 *
 * Decisions for Phase 4:
 *   - No top-level color legend: each grid cell already has its own
 *     colored-dot label (CompareGrid:115-124), and overlay has its own
 *     legend panel (CompareOverlay:138-163). A third shared legend would
 *     be redundant.
 *   - Missing, unreachable and processing are tracked separately, because
 *     they are three different pieces of news. A 404/403 fetch goes into
 *     `missing[]`: the server answered, that simulation is gone or is not
 *     this user's. A fetch that failed some other way (network, 5xx) goes
 *     into `unreachable[]`: nothing is known about the simulation at all.
 *     A sim that returns metadata but whose status is still
 *     `queued`/`running` goes into `processing[]`. Collapsing the first
 *     two into one banner would tell a reader on a flaky connection that
 *     their simulations had been deleted.
 */
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft, GitCompare } from 'lucide-react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { RgEvolutionChart } from '@/components/charts/RgEvolutionChart'
import type { RgSeries } from '@/components/charts/RgEvolutionChart'
import {
  CompareCameraProvider,
  useCompareCamera,
} from '@/components/compare/CompareCameraProvider'
import {
  CompareGrid,
  type CompareSim,
} from '@/components/compare/CompareGrid'
import {
  CompareMetricsTable,
  type CompareSimWithMetrics,
} from '@/components/compare/CompareMetricsTable'
import { CompareOverlay } from '@/components/compare/CompareOverlay'
import {
  CompareSettingsPanel,
  type CompareMode,
} from '@/components/compare/CompareSettingsPanel'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { Button } from '@/components/ui/button'
import { useProject } from '@/hooks/useProjects'
import { ApiError, simulationsApi } from '@/lib/api'
import {
  MAX_COMPARE_SIMS,
  deriveSimName,
  getCompareColorPalette,
  parseCompareSimsParam,
} from '@/lib/compare-utils'
import type { GeometryData, Simulation } from '@/lib/types'

interface CompareFetchResult {
  simulation: Simulation
  geometry: GeometryData | null
}

async function fetchSimulationWithGeometry(
  projectId: string,
  simId: string,
): Promise<CompareFetchResult> {
  const simulation = await simulationsApi.get(projectId, simId)
  let geometry: GeometryData | null = null
  if (simulation.status === 'completed') {
    try {
      geometry = await simulationsApi.getGeometry(simId)
    } catch {
      geometry = null
    }
  }
  return { simulation, geometry }
}

/**
 * Whether a failed fetch is the server answering "this simulation is gone or is
 * not yours" rather than "the request never came back".
 *
 * The two are different news and produce different screens. A 404/403 is an
 * answer about one id while the rest of the comparison still stands; a network
 * or 5xx failure says nothing about any id, and reporting it as "these
 * simulations could not be loaded, they were probably deleted" tells a reader
 * on a flaky connection that their work is gone.
 */
function isMissingSimError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403)
}

/**
 * Truncate a sim id for display in banners (8-char prefix keeps messages
 * readable while remaining unique enough for users to identify sims in
 * Django admin / logs).
 */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/**
 * What the empty surface says. The title is the same condition every time —
 * fewer than two simulations cannot be compared — but the reason differs, and
 * the reason is the only part a reader can act on.
 */
function emptyComparisonCopy(
  requested: number,
  loaded: number,
): { title: string; description: string } {
  if (requested === 0) {
    return {
      title: 'No simulations to compare',
      description: 'Select two or more simulations from the project page to compare them.',
    }
  }
  if (loaded === 0) {
    return {
      title: 'Fewer than two simulations to compare',
      description: 'None of the requested simulations are accessible. A comparison needs two.',
    }
  }
  return {
    title: 'Fewer than two simulations to compare',
    description:
      'Only one of the requested simulations can be compared. A comparison needs two.',
  }
}

/**
 * Robust extraction of particle count N for the Compare metrics table.
 *
 * Tries, in order:
 *   1. Top-level `simulation.n_particles` (some serializers expose it here).
 *   2. `simulation.parameters.n_particles` (the canonical nested location).
 *   3. `geometry.coordinates.length` (ground truth for completed sims).
 *   4. `geometry.radii.length` (fallback if coordinates is shaped
 *      differently for future algorithms).
 *
 * Each path uses a runtime `typeof` / `Array.isArray` / `hasOwnProperty`
 * check instead of a TypeScript cast, because the parameter union is wide
 * (DLA, CCA, BoxRFA, Imported, Limiting, ...) and `as { n_particles?: number }`
 * is a blind assertion — it returns `undefined` when the key doesn't exist
 * at runtime, silently hiding bugs in serializer coverage.
 */
function extractNParticles(sim: unknown, geom: unknown): number | null {
  const readFiniteNumber = (obj: unknown, key: string): number | null => {
    if (!obj || typeof obj !== 'object') return null
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return null
    const v = (obj as Record<string, unknown>)[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
  }

  // Path 1: direct top-level field on the simulation object
  const topLevel = readFiniteNumber(sim, 'n_particles')
  if (topLevel !== null) return topLevel

  // Path 2: inside parameters (canonical location)
  if (sim && typeof sim === 'object') {
    const params = (sim as Record<string, unknown>).parameters
    const fromParams = readFiniteNumber(params, 'n_particles')
    if (fromParams !== null) return fromParams
  }

  // Path 3/4: derive from geometry — ground truth for completed sims
  if (geom && typeof geom === 'object') {
    const g = geom as Record<string, unknown>
    if (Array.isArray(g.coordinates) && g.coordinates.length > 0) {
      return g.coordinates.length
    }
    if (Array.isArray(g.radii) && g.radii.length > 0) {
      return g.radii.length
    }
  }

  return null
}

export default function CompareSimulationsPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const projectId = params.id
  const { data: project } = useProject(projectId)

  const rawSims = searchParams?.get('sims') ?? null
  const { ids, truncated } = parseCompareSimsParam(rawSims)

  const queries = useQueries({
    queries: ids.map((simId) => ({
      queryKey: ['compare-simulation', projectId, simId],
      queryFn: () => fetchSimulationWithGeometry(projectId, simId),
      staleTime: Infinity,
      retry: false,
    })),
  })

  const loaded: Array<{ id: string; result: CompareFetchResult }> = []
  /** Sims the server answered 404/403 for: gone, or not this user's. */
  const missing: string[] = []
  /** Sims whose fetch failed for any other reason: nothing is known about them. */
  const unreachable: string[] = []
  /**
   * Sims whose metadata loaded successfully but whose `status` isn't
   * `completed` yet (queued / running / failed / cancelled). These are
   * surfaced as a softer, informational note — they aren't data errors.
   */
  const processing: Array<{ id: string; name: string }> = []
  let anyLoading = false

  for (let i = 0; i < ids.length; i++) {
    const q = queries[i]
    if (q.isLoading || q.isPending) {
      anyLoading = true
      continue
    }
    if (q.isError || !q.data) {
      if (q.isError && !isMissingSimError(q.error)) {
        unreachable.push(ids[i])
      } else {
        missing.push(ids[i])
      }
      continue
    }
    const result = q.data
    if (result.simulation.status !== 'completed' && !result.geometry) {
      processing.push({
        id: ids[i],
        name: deriveSimName(result.simulation),
      })
      continue
    }
    loaded.push({ id: ids[i], result })
  }

  const colorMap = useMemo(() => getCompareColorPalette(ids), [ids])

  // Map loaded sims → CompareSim + metrics shape for Grid/Overlay/Table/Chart.
  //
  // Note: `n_particles` is computed independently of `metrics` because N
  // is known from `parameters` / `geometry` even when Df/kf/Rg haven't
  // been computed yet (e.g. freshly imported aggregates where metrics are
  // still being calculated). Previously the whole metrics block was set
  // to null when `simulation.metrics` was null, causing the N column to
  // show '—' for imported/in-progress sims — which was the user-reported
  // bug on the Compare page after deploy.
  //
  // The `extractNParticles` helper below is defensive on purpose: two
  // prior fixes (9e63756, afc4ecb) assumed `parameters.n_particles`
  // would always be present for completed sims. In practice it isn't:
  // - `BoxRfaParams.n_particles` is optional (derived from n_levels)
  // - `ImportedParams.n_particles` is stamped by the server but older
  //   records predating that stamp are still in the DB
  // - Some algorithm variants may serialize it at the top level of the
  //   Simulation instead of nested under `parameters`
  // If N is still '—' after this fix, open devtools on the Compare page
  // and log `result.simulation` + `result.geometry` to see the actual
  // shape returned by `/api/simulations/:id/` — the real fix then is on
  // the backend serializer, not here.
  const compareSims: CompareSimWithMetrics[] = useMemo(
    () =>
      loaded.map(({ id, result }) => {
        const nParticles = extractNParticles(
          result.simulation,
          result.geometry,
        )

        const hasAnalyticMetrics = result.simulation.metrics !== null

        return {
          id,
          name: deriveSimName(result.simulation),
          // SAFETY: `parameters` is a wide union of per-algorithm shapes (DLA,
          // CCA, BoxRFA, Imported, Limiting, ...). This boundary only forwards
          // it to `getScaleFactorNm` and to the grid's opaque parameter bag,
          // both of which read keys defensively and never assume the shape;
          // TypeScript cannot express "any algorithm's parameters here".
          parameters: result.simulation.parameters as unknown as Record<
            string,
            unknown
          >,
          geometry: result.geometry,
          algorithm: result.simulation.algorithm,
          metrics:
            hasAnalyticMetrics || nParticles !== null
              ? {
                  fractal_dimension:
                    result.simulation.metrics?.fractal_dimension ?? null,
                  prefactor: result.simulation.metrics?.prefactor ?? null,
                  radius_of_gyration:
                    result.simulation.metrics?.radius_of_gyration ?? null,
                  n_particles: nParticles,
                }
              : null,
        }
      }),
    [loaded],
  )

  // CompareGrid/Overlay only need the narrower CompareSim shape.
  const gridSims: CompareSim[] = useMemo(
    () =>
      compareSims.map((s) => ({
        id: s.id,
        name: s.name,
        parameters: s.parameters,
        geometry: s.geometry,
      })),
    [compareSims],
  )

  // Build multi-series chart data for the Rg evolution chart. Sims
  // without rg_evolution produce an empty series — the chart lists them
  // under the plot as "no evolution data available".
  const rgSeries: RgSeries[] = useMemo(
    () =>
      compareSims.map((sim) => {
        const raw = loaded.find((l) => l.id === sim.id)?.result.simulation
          .metrics?.rg_evolution
        return {
          label: sim.name,
          color: colorMap[sim.id] ?? '#999999',
          rgEvolution: Array.isArray(raw) ? raw : [],
          parameters: sim.parameters,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareSims, colorMap],
  )

  /**
   * One cell is not a comparison, and the grid has nowhere to put it. Two is
   * the number the flow guarantees: the project page only offers the button
   * once two are ticked, so this state means the URL was edited or a
   * simulation was deleted in between.
   */
  const canCompare = loaded.length >= 2
  const failedToLoad = unreachable.length > 0
  // A request still in flight is not an empty set: the empty surface waits.
  const showEmptyComparison = !anyLoading && !failedToLoad && !canCompare
  const emptyCopy = emptyComparisonCopy(ids.length, loaded.length)
  const projectName = project?.name?.trim()

  return (
    <>
      <PageHeader
        eyebrow="COMPARE"
        title={projectName || 'Compare simulations'}
        meta={
          <span>
            {ids.length === 0
              ? 'No simulations selected'
              : `${loaded.length} of ${ids.length} loaded`}
          </span>
        }
        description="Grid draws each simulation in its own cell; overlay stacks them in one scene, each in its own colour."
        actions={
          <Link href={`/projects/${projectId}`}>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to project
            </Button>
          </Link>
        }
      />

      <div className="space-y-3">
        {truncated && (
          <Callout
            tone="info"
            title={`Showing first ${MAX_COMPARE_SIMS} simulations`}
          >
            The URL contained more than {MAX_COMPARE_SIMS} simulation ids. Only
            the first {MAX_COMPARE_SIMS} are rendered.
          </Callout>
        )}

        {failedToLoad && (
          <Callout tone="danger" title="Failed to load simulations">
            <p className="mb-1">
              The request did not come back. This is not a missing simulation:
              the runs are still there, this page could not read them.
            </p>
            <ul className="space-y-0.5 font-mono text-xs">
              {unreachable.map((id) => (
                <li key={id} data-sim-id={id}>
                  {shortId(id)}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {missing.length > 0 && (
          <div data-testid="compare-missing-banner">
            <Callout
              tone="warning"
              title={`${missing.length} of ${ids.length} simulations could not be loaded`}
            >
              <p className="mb-1">
                The server answered for these and will not hand them over. They
                were probably deleted, or you don&apos;t have access.
              </p>
              <ul className="space-y-0.5 font-mono text-xs">
                {missing.map((id) => (
                  <li key={id} data-sim-id={id}>
                    {shortId(id)}
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        )}

        {processing.length > 0 && (
          <div data-testid="compare-processing-banner">
            <Callout
              tone="info"
              title={`${processing.length} simulation${
                processing.length === 1 ? '' : 's'
              } still processing`}
            >
              <ul className="space-y-0.5 text-xs">
                {processing.map((p) => (
                  <li key={p.id}>
                    {p.name}: geometry is still being computed
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
      </div>

      {anyLoading && loaded.length === 0 && (
        <LoadingScreen message="Loading simulations..." />
      )}

      {showEmptyComparison && (
        <EmptyState
          className="mt-3"
          icon={GitCompare}
          headingLevel={2}
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={
            <Link href={`/projects/${projectId}`}>
              <Button>Select simulations</Button>
            </Link>
          }
        />
      )}

      {canCompare && (
        <div className="mt-4">
          <CompareCameraProvider>
            <CompareBody
              simulations={compareSims}
              gridSims={gridSims}
              rgSeries={rgSeries}
              colorMap={colorMap}
            />
          </CompareCameraProvider>
        </div>
      )}
    </>
  )
}

/**
 * Inner body rendered inside the camera provider. Hosts the settings
 * panel and swaps between grid and overlay. Kept as a separate component
 * so `useCompareCamera()` can be called inside the provider.
 *
 * The metrics table and the Rg chart stay outside `Panel`: they are slice 2's
 * surfaces and keep their own frames until that slice migrates them.
 */
function CompareBody({
  simulations,
  gridSims,
  rgSeries,
  colorMap,
}: {
  simulations: CompareSimWithMetrics[]
  gridSims: CompareSim[]
  rgSeries: RgSeries[]
  colorMap: Record<string, string>
}) {
  const [mode, setMode] = useState<CompareMode>('grid')
  const { synchronised, toggleSync } = useCompareCamera()

  return (
    <div className="space-y-4">
      <Panel
        title="Comparison"
        hint="Turning the camera in any view moves the others when sync is on; with sync off each view keeps its own."
      >
        {/* The controls sit above the view they drive, inside the same frame. */}
        <div className="mb-3">
          <CompareSettingsPanel
            mode={mode}
            onModeChange={setMode}
            synchronised={synchronised}
            onToggleSync={toggleSync}
          />
        </div>

        {mode === 'grid' ? (
          <CompareGrid simulations={gridSims} colorMap={colorMap} />
        ) : (
          <CompareOverlay simulations={gridSims} colorMap={colorMap} />
        )}
      </Panel>

      <CompareMetricsTable simulations={simulations} colorMap={colorMap} />

      <RgEvolutionChart series={rgSeries} />
    </div>
  )
}
