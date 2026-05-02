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
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/Header'
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
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Breadcrumb back to single-image FRAKTAL */}
        <Link
          href={`/projects/${id}/fraktal/new`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to single-image FRAKTAL
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Batch FRAKTAL Analysis</h1>
          <p className="text-muted-foreground mt-2">
            Upload a ZIP of projection images. Auto-calibration is applied when
            the ZIP carries metadata from a pyaglogen3D export; otherwise
            provide pixels per 100 nm manually.
          </p>
        </div>

        {!result ? (
          simLoading ? (
            <p className="text-muted-foreground">
              Loading simulation context...
            </p>
          ) : (
            <>
              {simError && (
                <p
                  className="mb-4 text-sm text-muted-foreground"
                  data-testid="sim-fetch-warning"
                >
                  Simulation context unavailable — proceeding with manual upload.
                </p>
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
            />
          </div>
        )}
      </main>
    </div>
  )
}
