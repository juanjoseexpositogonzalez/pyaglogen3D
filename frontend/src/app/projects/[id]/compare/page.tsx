'use client'

/**
 * Multi-aggregate Compare page — design-system kit, issue #175 slices 1 and 2.
 *
 * Reads `?sims=<csv>` from the URL, fetches each simulation's metadata
 * and geometry in parallel, partitions results into
 * loaded / missing / unreachable / processing, and composes the compare UI:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ PageHeader — project name, counts, way back            │
 *   │ Truncation note (>9 sim ids)                           │
 *   │ Session-expired notice (401: sign in again)            │
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
 * What gets drawn is what loaded: one simulation renders a one-cell grid, one
 * metrics column and one chart series (spec `multi-aggregate-comparison` S8.4
 * and R5). The empty surface is reserved for having nothing to draw at all
 * (S8.3), which is a different statement from "fewer than two arrived".
 *
 * Decisions for Phase 4:
 *   - No top-level color legend: each grid cell already has its own
 *     colored-dot label (CompareGrid:115-124), and overlay has its own
 *     legend panel (CompareOverlay:138-163). A third shared legend would
 *     be redundant.
 *   - Five outcomes are tracked separately, because they are five different
 *     pieces of news. A 404/403 fetch goes into `missing[]`: the server
 *     answered, that simulation is gone or is not this user's. A 401 goes
 *     into `expired[]`: the server answered too, and what failed is the
 *     session. A fetch that failed some other way (network, 5xx) goes into
 *     `unreachable[]`: nothing is known about the simulation at all. A sim
 *     that returns metadata but whose status is still `queued`/`running`
 *     goes into `processing[]`. Collapsing these into one banner would tell
 *     a reader on a flaky connection that their work had been deleted, or
 *     tell a reader with two running simulations that nothing was found.
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
import { MetricCard } from '@/components/kit/MetricCard'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { buttonVariants } from '@/components/ui/button'
import { useProject } from '@/hooks/useProjects'
import { ApiError, simulationsApi } from '@/lib/api'
import { series } from '@/lib/chart-theme'
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
 * How a failed fetch is reported. Three different pieces of news share one
 * shape of failure and must not share one message:
 *
 *   - `missing`    — the server answered 404/403: this id is gone, or it is not
 *                    this user's. The rest of the comparison still stands.
 *   - `expired`    — the server answered 401: the request arrived and the
 *                    session did not. Retrying is the wrong instruction;
 *                    signing in again is the right one.
 *   - `unreachable` — anything else (network, DNS, timeout): it is not known
 *                    whether the simulation exists, so nothing may be claimed
 *                    about it.
 *
 * Reporting an outage as "deleted", a dead session as "no answer", or a 500 as
 * "the request never arrived" sends a reader to fix something that is not
 * broken.
 */
type FetchFailure = 'missing' | 'expired' | 'server' | 'network'

function classifyFetchFailure(error: unknown): FetchFailure {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 403) return 'missing'
    if (error.status === 401) return 'expired'
    // 5xx is an answer as well: the request arrived and the server broke. It is
    // neither a dead session nor a dead connection, so it gets its own words.
    if (error.status >= 500) return 'server'
    // 5xx is an answer as well: the request arrived and the server broke. It is
    // neither a dead session nor a dead connection, so it gets its own words.
  }
  return 'network'
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
 * What the empty surface says. It is only shown when there is nothing to draw
 * at all (spec S8.3), so the reason it gives is always "nothing arrived" —
 * whether because nothing was selected or because the server refused every id.
 */
function emptyComparisonCopy(requested: number): { title: string; description: string } {
  if (requested === 0) {
    return {
      title: 'No simulations to compare',
      description: 'Select two or more simulations from the project page to compare them.',
    }
  }
  return {
    title: 'No simulations to compare',
    description: 'None of the requested simulations are accessible.',
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
  /** Sims the server answered 401 for: the session ended, the ids are fine. */
  const expired: string[] = []
  /** Sims whose request the server took and then failed on (5xx). */
  const serverFailed: string[] = []
  /** Sims whose request never reached the server: nothing is known about them. */
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
      const failure = q.isError ? classifyFetchFailure(q.error) : 'missing'
      if (failure === 'missing') missing.push(ids[i])
      else if (failure === 'expired') expired.push(ids[i])
      else if (failure === 'server') serverFailed.push(ids[i])
      else unreachable.push(ids[i])
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
      compareSims.map((sim, index) => {
        const raw = loaded.find((l) => l.id === sim.id)?.result.simulation
          .metrics?.rg_evolution
        return {
          label: sim.name,
          // The palette colour is the simulation's identity, shared with its
          // grid cell and its metrics column. An id the palette does not cover
          // falls to the series ramp by position rather than to one grey.
          color: colorMap[sim.id] ?? series(index),
          rgEvolution: Array.isArray(raw) ? raw : [],
          parameters: sim.parameters,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareSims, colorMap],
  )

  /**
   * One cell is a comparison of one, and the spec asks for exactly that: S8.4
   * draws `?sims=A,B` with A refused as "grid renders B only", and R5 asks for
   * one metrics column per successfully loaded simulation. Hiding the survivor
   * would throw away the data the page exists for.
   */
  const canCompare = loaded.length >= 1
  const failedToLoad = unreachable.length > 0 || serverFailed.length > 0
  const sessionExpired = expired.length > 0
  /**
   * The empty surface is for having nothing to draw — nothing selected, or
   * every id refused (S8.3). It is not for "not everything is here yet": a
   * request in flight, a run still computing, or an outage all have their own
   * notice, and telling a reader their simulations are inaccessible while
   * another banner says those simulations are running is two lies at once.
   */
  const showEmptyComparison =
    !anyLoading &&
    !failedToLoad &&
    !sessionExpired &&
    loaded.length === 0 &&
    processing.length === 0
  const emptyCopy = emptyComparisonCopy(ids.length)
  const projectName = project?.name?.trim()

  return (
    <>
      <PageHeader
        eyebrow="PROJECT"
        title="Compare simulations"
        meta={
          <>
            {/*
              The title names the screen; the project is identity, which is what
              this row is for. The project detail page already owns its own name
              as its <h1>, and two screens titled "Soot aggregates" leave a
              reader moving by heading unable to tell them apart.
            */}
            {projectName && <span>{projectName}</span>}
            <span>
              {ids.length === 0
                ? 'No simulations selected'
                : `${loaded.length} of ${ids.length} loaded`}
            </span>
          </>
        }
        description="Grid draws each simulation in its own cell; overlay stacks them in one scene, each in its own colour."
        // `Button` has an `asChild` prop that is declared and not implemented, so
        // wrapping it in a Link puts a <button> inside an <a>: invalid HTML, two
        // tab stops for one destination, and a visible target that swallows the
        // modifier-click. The look comes from the variant's classes instead.
        actions={
          <Link
            href={`/projects/${projectId}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to project
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

        {sessionExpired && (
          <Callout
            tone="danger"
            title="Your session expired"
            action={
              <Link
                href="/auth/login"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Sign in again
              </Link>
            }
          >
            The server answered, but it no longer recognises this session, so
            none of these simulations could be read. Signing in again is what
            restores access; retrying will not.
          </Callout>
        )}

        {serverFailed.length > 0 && (
          <Callout tone="danger" title="The server could not answer">
            <p className="mb-1">
              The request reached the server and it failed there. Nothing was
              lost and nothing is missing: this is a fault on the server&apos;s
              side, and trying again in a moment is the thing that helps.
            </p>
            <ul className="space-y-0.5 font-mono text-xs">
              {serverFailed.map((id) => (
                <li key={id} data-sim-id={id}>
                  {shortId(id)}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {unreachable.length > 0 && (
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
        /*
          `LoadingScreen` paints a bare div, so the page owes it a surface. A kit
          panel keeps the wait on the same paper as the rest of the product and
          gives its message the ink that was measured against it.
        */
        <Panel className="mt-3">
          <LoadingScreen message="Loading simulations..." />
        </Panel>
      )}

      {showEmptyComparison && (
        <EmptyState
          className="mt-3"
          icon={GitCompare}
          headingLevel={2}
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={
            <Link href={`/projects/${projectId}`} className={buttonVariants()}>
              Select simulations
            </Link>
          }
        />
      )}

      {canCompare && (
        <>
          {/*
            Counts, not readings: how much of the requested set this comparison
            is actually made of. `MetricCard`'s `exact` variant is the one that
            demands no sigma and no estimator, because a count has neither. The
            two cards only exist once there is something to count — above an
            empty state they would be describing nothing.
          */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetricCard
              kind="exact"
              tone="teal"
              label="Simulations compared"
              value={loaded.length}
              digits={0}
              detail="Each one drawn in its own colour, with its own metrics column and curve"
            />
            <MetricCard
              kind="exact"
              tone="slate"
              label="Not in the comparison"
              value={ids.length - loaded.length}
              digits={0}
              detail="Requested but not drawn: still arriving, still computing, refused by the server, or unreachable"
            />
          </div>

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
        </>
      )}
    </>
  )
}

/**
 * Inner body rendered inside the camera provider. Hosts the settings
 * panel and swaps between grid and overlay. Kept as a separate component
 * so `useCompareCamera()` can be called inside the provider.
 *
 * The metrics table and the Rg chart get a `Panel` each: they are this
 * screen's two reading surfaces, and a surface is what a chart hands its ink
 * and grid to. The chart's own Plotly title is gone in favour of the panel's
 * heading, so one name is said once.
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

      <Panel title="Metrics">
        {/* The table's own caption says what a column holds, so the panel only
            names the surface. */}
        <CompareMetricsTable simulations={simulations} colorMap={colorMap} />
      </Panel>

      <Panel
        title="Radius of gyration evolution"
        hint="log10 of Rg against log10 of N, one curve per simulation. The plot takes its ink and its grid from the theme in force, so it is readable on the paper it is drawn on in both themes."
      >
        <RgEvolutionChart series={rgSeries} />
      </Panel>
    </div>
  )
}
