'use client'

/**
 * Multi-aggregate Compare page — Phase 3 (T12) adds mode toggle + real viewers.
 *
 * Reads `?sims=<csv>` from the URL, fetches each simulation's metadata
 * and geometry in parallel, partitions results into loaded/missing, and
 * renders either `<CompareGrid>` or `<CompareOverlay>` inside a shared
 * `<CompareCameraProvider>` based on the selected mode.
 *
 * Phase 3 changes:
 *   - Wraps the rendered viewer in `<CompareCameraProvider>` so all
 *     cells share a camera scope (or each owns its own when unsynced).
 *   - Adds an inline mode toggle (Grid / Overlay) and a sync toggle.
 *     Both are simple button-segment controls for now; the polished
 *     `CompareSettingsPanel` comes in T16.
 *   - Maps loaded sims → `CompareSim` shape (id, name, parameters,
 *     geometry) that both grid and overlay consume.
 *
 * Deferred to Phase 4:
 *   - Metrics table (T14)
 *   - Multi-series Rg chart (T15)
 *   - Polished settings panel (T16)
 *   - Corner legend panel for grid mode (T17)
 *   - Finalized missing-sim banner styling (T18)
 */
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { LoadingScreen } from '@/components/common/LoadingSpinner'
import {
  CompareCameraProvider,
  useCompareCamera,
} from '@/components/compare/CompareCameraProvider'
import {
  CompareGrid,
  type CompareSim,
} from '@/components/compare/CompareGrid'
import { CompareOverlay } from '@/components/compare/CompareOverlay'
import { Header } from '@/components/layout/Header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { simulationsApi } from '@/lib/api'
import {
  MAX_COMPARE_SIMS,
  getCompareColorPalette,
  parseCompareSimsParam,
} from '@/lib/compare-utils'
import type { GeometryData, Simulation } from '@/lib/types'
import { cn } from '@/lib/utils'

interface CompareFetchResult {
  simulation: Simulation
  geometry: GeometryData | null
}

type CompareMode = 'grid' | 'overlay'

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
 * Derive a human-readable display name for a simulation. The `Simulation`
 * type doesn't carry a `name` field today — we synthesize from algorithm
 * + short id. If/when the backend exposes a user-editable name, replace
 * this helper only.
 */
function deriveSimName(sim: Simulation): string {
  return `${sim.algorithm.toUpperCase()} · ${sim.id.slice(0, 8)}`
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
    loaded.push({ id: ids[i], result: q.data })
  }

  const colorMap = useMemo(() => getCompareColorPalette(ids), [ids])

  // Map loaded sims → CompareSim shape consumed by Grid + Overlay.
  const compareSims: CompareSim[] = useMemo(
    () =>
      loaded.map(({ id, result }) => ({
        id,
        name: deriveSimName(result.simulation),
        // `SimulationParams` is a union — cast to a plain record so
        // `getScaleFactorNm` (which takes `Record<string, unknown>`) can
        // read `primary_particle_diameter_nm` / `primary_particle_radius_nm`
        // without the union narrowing noise.
        parameters: result.simulation.parameters as unknown as Record<
          string,
          unknown
        >,
        geometry: result.geometry,
      })),
    [loaded],
  )

  const isEmpty = !anyLoading && loaded.length === 0

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
          <Alert variant="destructive">
            <AlertTitle>
              {missing.length} of {ids.length} simulations could not be loaded
            </AlertTitle>
            <AlertDescription>
              <span className="font-mono text-xs">{missing.join(', ')}</span>
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
            <CompareBody simulations={compareSims} colorMap={colorMap} />
          </CompareCameraProvider>
        )}
      </main>
    </div>
  )
}

/**
 * Inner body rendered inside the camera provider. Hosts the mode/sync
 * toggles and swaps between grid and overlay. Kept as a separate
 * component so the toggles can call `useCompareCamera()` (which needs to
 * sit inside the provider).
 */
function CompareBody({
  simulations,
  colorMap,
}: {
  simulations: CompareSim[]
  colorMap: Record<string, string>
}) {
  const [mode, setMode] = useState<CompareMode>('grid')
  const { synchronised, toggleSync } = useCompareCamera()

  return (
    <>
      {/* Inline toolbar — real settings panel comes in T16. */}
      <div
        data-testid="compare-toolbar"
        className="flex flex-wrap items-center gap-3"
      >
        <div
          role="group"
          aria-label="View mode"
          className="inline-flex overflow-hidden rounded-md border"
        >
          <Button
            type="button"
            variant={mode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('grid')}
            className={cn('rounded-none', mode !== 'grid' && 'text-foreground')}
            data-testid="compare-mode-grid"
            aria-pressed={mode === 'grid'}
          >
            Grid
          </Button>
          <Button
            type="button"
            variant={mode === 'overlay' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('overlay')}
            className={cn(
              'rounded-none',
              mode !== 'overlay' && 'text-foreground',
            )}
            data-testid="compare-mode-overlay"
            aria-pressed={mode === 'overlay'}
          >
            Overlay
          </Button>
        </div>

        {/* Sync toggle is only meaningful in grid mode (overlay already
            shares a single canvas/camera) — but we render it always for
            UX simplicity. */}
        <Button
          type="button"
          variant={synchronised ? 'default' : 'outline'}
          size="sm"
          onClick={toggleSync}
          data-testid="compare-sync-toggle"
          aria-pressed={synchronised}
        >
          {synchronised ? 'Cameras: synced' : 'Cameras: independent'}
        </Button>
      </div>

      {mode === 'grid' ? (
        <CompareGrid simulations={simulations} colorMap={colorMap} />
      ) : (
        <CompareOverlay simulations={simulations} colorMap={colorMap} />
      )}
    </>
  )
}
