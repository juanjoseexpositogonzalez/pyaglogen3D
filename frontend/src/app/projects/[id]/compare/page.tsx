'use client'

/**
 * Multi-aggregate Compare page — Phase 2 scaffold.
 *
 * This page reads `?sims=<csv>` from the URL, fetches each simulation's
 * metadata and geometry in parallel, partitions the results into
 * loaded/missing, and lays out a responsive grid placeholder.
 *
 * The real 3D rendering (CompareGrid / CompareOverlay) lands in Phase 3
 * (tasks T10/T11). The placeholder here verifies the route plumbing:
 *   - URL parse → dedup + cap
 *   - parallel react-query fetches
 *   - partition loaded vs missing
 *   - truncation warning (R10)
 *   - missing-sim banner (R8)
 *   - empty state when all fail / no ids
 *   - responsive grid shape via getCompareGridLayout
 */
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { Header } from '@/components/layout/Header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { simulationsApi } from '@/lib/api'
import {
  MAX_COMPARE_SIMS,
  getCompareColorPalette,
  getCompareGridLayout,
  parseCompareSimsParam,
} from '@/lib/compare-utils'
import type { GeometryData, Simulation } from '@/lib/types'

interface CompareFetchResult {
  simulation: Simulation
  geometry: GeometryData | null
}

/**
 * Pair the sim metadata fetch with its geometry fetch. If the metadata
 * fetch fails (404/403) we propagate the error — the sim is counted as
 * missing. If metadata succeeds but the sim hasn't produced geometry yet
 * (`status !== 'completed'`), we return null geometry and let the render
 * decide — still counted as "loaded" so users see something.
 */
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
      // Geometry fetch failure on a completed sim: treat the whole row
      // as degraded but keep the sim rendered (Phase 3 viewer shows an
      // empty-geometry state; here we simply display a warning in the
      // cell).
      geometry = null
    }
  }
  return { simulation, geometry }
}

export default function CompareSimulationsPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const projectId = params.id

  const rawSims = searchParams?.get('sims') ?? null
  const { ids, truncated } = parseCompareSimsParam(rawSims)

  // Parallel fetches — one entry per id. Each resolver composes the two
  // API calls so we can partition loaded/missing uniformly.
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

  const colorMap = getCompareColorPalette(ids)
  const layout = getCompareGridLayout(loaded.length)

  // Empty state: nothing to parse (all-invalid URL) or every fetch failed.
  const isEmpty = !anyLoading && loaded.length === 0

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Breadcrumb */}
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to project
        </Link>

        {/* Title */}
        <div>
          <h1 className="text-3xl font-bold">Compare simulations</h1>
          <p className="text-muted-foreground mt-1">
            {ids.length === 0
              ? 'No simulations selected.'
              : `${loaded.length} of ${ids.length} loaded`}
          </p>
        </div>

        {/* R10 — truncation warning: raw URL had more than MAX_COMPARE_SIMS ids. */}
        {truncated && (
          <Alert>
            <AlertTitle>Showing first {MAX_COMPARE_SIMS} simulations</AlertTitle>
            <AlertDescription>
              The URL contained more than {MAX_COMPARE_SIMS} simulation ids.
              Only the first {MAX_COMPARE_SIMS} are rendered.
            </AlertDescription>
          </Alert>
        )}

        {/* R8 — missing sim banner. Non-dismissible per spec; always visible when any fail. */}
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

        {/* Loading */}
        {anyLoading && loaded.length === 0 && (
          <LoadingScreen message="Loading simulations..." />
        )}

        {/* Empty state — no ids at all, or every requested sim failed. */}
        {isEmpty && (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="text-lg font-medium mb-2">
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

        {/* Placeholder grid — real viewers land in Phase 3 (T10/T11). */}
        {loaded.length > 0 && (
          <div
            data-testid="compare-grid"
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
            }}
          >
            {loaded.map(({ id, result }) => {
              const color = colorMap[id] ?? '#999999'
              const name = result.simulation.algorithm.toUpperCase()
              return (
                <div
                  key={id}
                  className="aspect-square rounded-lg border-2 p-4 flex flex-col items-center justify-center bg-muted/20"
                  style={{ borderColor: color }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-sm">{name}</span>
                  </div>
                  <span className="mt-2 text-xs text-muted-foreground">
                    {id.slice(0, 8)}…
                  </span>
                  <span className="mt-4 text-xs text-muted-foreground italic">
                    Viewer in Phase 3
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
