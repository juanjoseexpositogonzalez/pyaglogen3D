'use client'

/**
 * Batch FRAKTAL analysis page (T4.5, change: fraktal-batch-analysis).
 *
 * Composes the upload form (client-side metadata detection + submission)
 * with the results view (stats / histogram / per-image table / Sorensen
 * comparison). State is held locally: once a batch completes we swap the
 * upload UI out for the results UI, with a "analyze another batch" button
 * that resets back to the form.
 *
 * Frente 9 P5: when navigated from a simulation results page with the
 * `?origin=simulation&sim_id=X` query params, fetches the simulation and
 * passes `origin="simulation"` + `simulation={...}` props to the upload
 * component so autocalibrate defaults to OFF with the known dpo. Falls
 * back gracefully to external mode if the sim 404s or query params are
 * missing/malformed.
 *
 * On the design-system kit (issue #176, slice 3 of 3, part A): the page names
 * itself with `PageHeader` and stops drawing the document frame. `Header` and
 * a `<main>` used to be mounted here to cover the sessions the shell leaves
 * chromeless. `showChrome` is `!chromeless && isAuthenticated && !isLoading`,
 * while the middleware only checks that a session cookie exists — so a stale
 * cookie with a rejected token paints this route with no rail and no top bar,
 * and `Header` was the one way out of it. Dropping both is the migration's
 * deliberate trade (navigation is the shell's job, not this page's), not a
 * claim that the two are equivalent. The column keeps the 1024px measure the
 * page always had, because the results view it hosts is wide.
 *
 * The two notices on the screen are not the same kind of thing: a simulation
 * that could not be fetched is a recoverable fallback and reads as a warning,
 * with the page carrying on in external mode. Neither text changed.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Callout } from '@/components/kit/Callout'
import { PageHeader } from '@/components/kit/PageHeader'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { FraktalBatchUpload } from '@/components/fraktal/FraktalBatchUpload'
import { FraktalBatchResultsView } from '@/components/fraktal/FraktalBatchResultsView'
import { simulationsApi, type FraktalBatchResult } from '@/lib/api'
import { getPrimaryParticleDiameterNm } from '@/lib/units'

interface SimRefForUpload {
  id: string
  parameters: { dpo_nm: number }
}

export default function FraktalBatchPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const searchParams = useSearchParams()
  const [result, setResult] = useState<FraktalBatchResult | null>(null)

  // Frente 9 P5: parse sim-origin entry params.
  const origin = searchParams?.get('origin')
  const simIdParam = searchParams?.get('sim_id')
  const isSimOriginRequested =
    origin === 'simulation' && typeof simIdParam === 'string' && simIdParam.length > 0

  const [simRef, setSimRef] = useState<SimRefForUpload | null>(null)
  const [simLoading, setSimLoading] = useState(isSimOriginRequested)
  const [simError, setSimError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSimOriginRequested) {
      setSimRef(null)
      setSimLoading(false)
      setSimError(null)
      return
    }

    let cancelled = false
    setSimLoading(true)
    setSimError(null)

    simulationsApi
      .get(id, simIdParam!)
      .then((sim) => {
        if (cancelled) return
        // Sim parameters can use either v2 (`primary_particle_diameter_nm`)
        // or v1 (`primary_particle_radius_nm`); the helper resolves both.
        // SAFETY: `parameters` is a JSON object on the wire whose keys depend
        // on the schema version the run was created under, so its declared
        // type says nothing the resolver can use. `getPrimaryParticleDiameterNm`
        // probes both key spellings and returns without a diameter when neither
        // is present, so no assumption about the shape survives this call.
        const dpo_nm = getPrimaryParticleDiameterNm(
          sim.parameters as unknown as Record<string, unknown>,
        )
        setSimRef({ id: sim.id, parameters: { dpo_nm } })
        setSimLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        // Soft fallback: log and proceed in external mode rather than
        // blocking the user.
        // eslint-disable-next-line no-console
        console.warn('Sim fetch for batch upload failed:', err)
        setSimError(err?.message || 'Failed to load simulation')
        setSimRef(null)
        setSimLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, simIdParam, isSimOriginRequested])

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* Breadcrumb back to single-image FRAKTAL */}
      <Link
        href={`/projects/${id}/fraktal/new`}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to single-image FRAKTAL
      </Link>

      <PageHeader
        eyebrow="FRAKTAL"
        title="Batch FRAKTAL Analysis"
        description="Upload a ZIP of projection images. Auto-calibration is applied when the ZIP carries metadata from a pyaglogen3D export; otherwise provide pixels per 100 nm manually."
      />

      {!result ? (
        simLoading ? (
          <LoadingScreen message="Loading simulation context..." />
        ) : (
          <>
            {simError && (
              // `data-testid` on the wrapper: `Callout` takes no arbitrary
              // attributes, and the fallback notice is what the page's own
              // regression test pins.
              <div className="mb-4" data-testid="sim-fetch-warning">
                <Callout
                  tone="warning"
                  title="Simulation context unavailable — proceeding with manual upload."
                />
              </div>
            )}
            <FraktalBatchUpload
              projectId={id}
              onSuccess={setResult}
              origin={simRef ? 'simulation' : 'external'}
              simulation={simRef ?? undefined}
            />
          </>
        )
      ) : (
        <div className="space-y-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResult(null)}
          >
            Analyze another batch
          </Button>
          <FraktalBatchResultsView
            result={result}
            projectId={id}
            batchId={result.batch_id ?? ''}
            onDeleted={() => setResult(null)}
            onResultUpdate={setResult}
          />
        </div>
      )}
    </div>
  )
}
