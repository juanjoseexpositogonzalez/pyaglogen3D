'use client'

/**
 * Multi-aggregate Compare page — Phase 4 polish (T14-T18).
 *
 * Reads `?sims=<csv>` from the URL, fetches each simulation's metadata
 * and geometry in parallel, partitions results into
 * loaded / missing / processing, and composes the full compare UI:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Header / breadcrumb / title                                 │
 *   │ Truncation banner (>9 sim ids)                              │
 *   │ Missing-sim banner (404/403 fetches)                        │
 *   │ Still-processing note (sim exists but no geometry yet)      │
 *   │ CompareSettingsPanel (mode + sync toggles)                  │
 *   │ CompareGrid  |  CompareOverlay                              │
 *   │ CompareMetricsTable                                         │
 *   │ RgEvolutionChart (multi-series)                             │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Decisions for Phase 4:
 *   - No top-level color legend: each grid cell already has its own
 *     colored-dot label (CompareGrid:115-124), and overlay has its own
 *     legend panel (CompareOverlay:138-163). A third shared legend would
 *     be redundant.
 *   - Missing vs processing are tracked separately: a 404/403 fetch goes
 *     into `missing[]` and renders the destructive "could not be loaded"
 *     banner; a sim that returns metadata but whose status is still
 *     `queued`/`running` goes into `processing[]` and renders a
 *     separate, informational note.
 */
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
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
import { Header } from '@/components/layout/Header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { simulationsApi } from '@/lib/api'
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
 * Truncate a sim id for display in banners (8-char prefix keeps messages
 * readable while remaining unique enough for users to identify sims in
 * Django admin / logs).
 */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
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
  const missing: string[] = []
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
      missing.push(ids[i])
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

  const isEmpty =
    !anyLoading && loaded.length === 0 && processing.length === 0

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto space-y-6 px-4 py-8">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to project
        </Link>

        <div>
          <h1 className="text-3xl font-bold">Compare simulations</h1>
          <p className="mt-1 text-muted-foreground">
            {ids.length === 0
              ? 'No simulations selected.'
              : `${loaded.length} of ${ids.length} loaded`}
          </p>
        </div>

        {truncated && (
          <Alert>
            <AlertTitle>
              Showing first {MAX_COMPARE_SIMS} simulations
            </AlertTitle>
            <AlertDescription>
              The URL contained more than {MAX_COMPARE_SIMS} simulation ids.
              Only the first {MAX_COMPARE_SIMS} are rendered.
            </AlertDescription>
          </Alert>
        )}

        {missing.length > 0 && (
          <Alert variant="destructive" data-testid="compare-missing-banner">
            <AlertTitle>
              {missing.length} of {ids.length} simulations could not be loaded
            </AlertTitle>
            <AlertDescription>
              <p className="mb-1">
                They were probably deleted or you don&apos;t have access.
              </p>
              <ul className="space-y-0.5 font-mono text-xs">
                {missing.map((id) => (
                  <li key={id} data-sim-id={id}>
                    {shortId(id)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {processing.length > 0 && (
          <Alert data-testid="compare-processing-banner">
            <AlertTitle>
              {processing.length} simulation{processing.length === 1 ? '' : 's'}{' '}
              still processing
            </AlertTitle>
            <AlertDescription>
              <ul className="space-y-0.5 text-xs">
                {processing.map((p) => (
                  <li key={p.id}>
                    {p.name}: geometry is still being computed
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {anyLoading && loaded.length === 0 && (
          <LoadingScreen message="Loading simulations..." />
        )}

        {isEmpty && (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="mb-2 text-lg font-medium">
                No simulations to compare
              </h2>
              <p className="text-muted-foreground">
                {ids.length === 0
                  ? 'Select two or more simulations from the project page to compare them.'
                  : 'None of the requested simulations are accessible.'}
              </p>
            </CardContent>
          </Card>
        )}

        {loaded.length > 0 && (
          <CompareCameraProvider>
            <CompareBody
              simulations={compareSims}
              gridSims={gridSims}
              rgSeries={rgSeries}
              colorMap={colorMap}
            />
          </CompareCameraProvider>
        )}
      </main>
    </div>
  )
}

/**
 * Inner body rendered inside the camera provider. Hosts the settings
 * panel and swaps between grid and overlay. Kept as a separate component
 * so `useCompareCamera()` can be called inside the provider.
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
    <>
      <CompareSettingsPanel
        mode={mode}
        onModeChange={setMode}
        synchronised={synchronised}
        onToggleSync={toggleSync}
      />

      {mode === 'grid' ? (
        <CompareGrid simulations={gridSims} colorMap={colorMap} />
      ) : (
        <CompareOverlay simulations={gridSims} colorMap={colorMap} />
      )}

      <CompareMetricsTable simulations={simulations} colorMap={colorMap} />

      <RgEvolutionChart series={rgSeries} />
    </>
  )
}
