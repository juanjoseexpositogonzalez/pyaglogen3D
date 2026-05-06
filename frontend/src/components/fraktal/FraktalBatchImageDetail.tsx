'use client'

/**
 * FraktalBatchImageDetail — drill-down view for a single image in a batch
 * (T5.3 + T5.4 + T5.5, change: fraktal-drilldown-and-csv).
 *
 * Renders:
 *   - PNG image via getBatchImagePngUrl (URL for <img src>)
 *   - Per-image metrics (Df, kf, R², n_particles, dpo_used)
 *   - Error banner if the image analysis failed
 *   - Prev/Next navigation (links + ArrowLeft/ArrowRight keyboard shortcuts)
 *   - Loading skeleton during fetch
 *   - Error banner on fetch failure (404, 403)
 *   - Back link to batch results
 *   - Re-analyze button placeholder (wiring is Phase 6)
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
} from 'lucide-react'

import { fraktalApi, type FraktalBatchImageDetail as ImageDetailData } from '@/lib/api'
import { QualityBadge } from '@/components/common/QualityBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  projectId: string
  batchId: string
  index: number
}

export function FraktalBatchImageDetail({ projectId, batchId, index }: Props) {
  const router = useRouter()
  const [data, setData] = useState<ImageDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [currentVariant, setCurrentVariant] = useState<'presentation' | 'scientific'>('presentation')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    setCurrentVariant('presentation') // reset variant on image change

    fraktalApi
      .getBatchImage(projectId, batchId, index)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load image detail')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId, batchId, index])

  // Fetch PNG with auth (Bearer token) and create blob URL for <img>.
  // Revokes previous blob URL on cleanup (unmount or dependency/variant change).
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setBlobUrl(null)
    setImageError(null)

    fraktalApi
      .fetchBatchImagePng(projectId, batchId, index, currentVariant)
      .then((blob) => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob)
          setBlobUrl(objectUrl)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setImageError(err?.message || 'Failed to load image')
        }
      })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [projectId, batchId, index, currentVariant])

  const handleReanalyze = useCallback(async () => {
    setReanalyzing(true)
    try {
      const { analysis_id } = await fraktalApi.reanalyzeBatchImage(
        projectId,
        batchId,
        index
      )
      router.push(`/projects/${projectId}/fraktal/${analysis_id}`)
    } catch (err) {
      console.error('Re-analyze failed:', err)
    } finally {
      setReanalyzing(false)
    }
  }, [projectId, batchId, index, router])

  // Keyboard shortcuts for prev/next
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!data) return
      if (e.key === 'ArrowLeft' && data.prev_index !== null) {
        router.push(
          `/projects/${projectId}/fraktal/batch/${batchId}/image/${data.prev_index}`
        )
      } else if (e.key === 'ArrowRight' && data.next_index !== null) {
        router.push(
          `/projects/${projectId}/fraktal/batch/${batchId}/image/${data.next_index}`
        )
      }
    },
    [data, projectId, batchId, router]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const batchUrl = `/projects/${projectId}/fraktal/batch/${batchId}`

  // --- Loading state ---
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <p className="text-muted-foreground">Loading image detail...</p>
        <div className="mt-4 space-y-4">
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
          <div className="h-8 bg-muted animate-pulse rounded w-1/3" />
          <div className="h-8 bg-muted animate-pulse rounded w-1/2" />
        </div>
      </div>
    )
  }

  // --- Error state (metadata fetch failed or no data) ---
  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Card className="border-destructive">
          <CardContent className="p-6">
            <p className="text-destructive">
              Failed to load image detail. {error}
            </p>
            <Link
              href={batchUrl}
              className="mt-4 inline-block"
            >
              <Button variant="outline" aria-label="Back to batch results">
                Back to batch results
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Image fetch error (PNG auth failed, e.g. 401/404) ---
  if (imageError) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Card className="border-destructive">
          <CardContent className="p-6">
            <p className="text-destructive">
              Failed to load image. {imageError}
            </p>
            <Link
              href={batchUrl}
              className="mt-4 inline-block"
            >
              <Button variant="outline" aria-label="Back to batch results">
                Back to batch results
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const pngUrl = fraktalApi.getBatchImagePngUrl(projectId, batchId, index)

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Back link */}
        <Link
          href={batchUrl}
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
          aria-label="Back to batch results"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to batch results
        </Link>

        {/* Title + navigation */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">
            Image {data.index} — {data.filename}
          </h1>

          <div className="flex gap-2">
            {/* T6.6: Download PNG */}
            <a
              href={pngUrl}
              download={`batch-${batchId}-image-${data.index}.png`}
              aria-label="Download PNG"
            >
              <Button variant="outline" type="button">
                <Download className="h-4 w-4 mr-2" />
                Download PNG
              </Button>
            </a>
            {/* T6.5: Re-analyze button */}
            <Button
              variant="outline"
              onClick={handleReanalyze}
              disabled={reanalyzing}
              aria-label="Re-analyze"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {reanalyzing ? 'Re-analyzing...' : 'Re-analyze'}
            </Button>
          </div>
        </div>

        {/* Prev / Next navigation */}
        <div className="flex items-center justify-between mb-6">
          {data.prev_index !== null ? (
            <Link
              href={`/projects/${projectId}/fraktal/batch/${batchId}/image/${data.prev_index}`}
              aria-label="Previous image"
            >
              <Button variant="outline" size="sm">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              aria-label="Previous image"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
          )}

          <span className="text-muted-foreground text-sm">
            Image {data.index} of batch
          </span>

          {data.next_index !== null ? (
            <Link
              href={`/projects/${projectId}/fraktal/batch/${batchId}/image/${data.next_index}`}
              aria-label="Next image"
            >
              <Button variant="outline" size="sm">
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              aria-label="Next image"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

        {/* Analysis input variant badge + batch origin (T5.5 + T5.6) */}
        <div className="flex items-center gap-2 mb-4">
          {data.analysis_input_variant && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-muted-foreground/20">
              Analysis input:{' '}
              {data.analysis_input_variant === 'scientific'
                ? 'Scientific (binary)'
                : 'Presentation'}
            </span>
          )}
          {data.batch_origin && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-muted-foreground/20">
              Origin: {data.batch_origin === 'simulation' ? 'From Simulation' : 'External upload'}
            </span>
          )}
        </div>

        {/* Variant toggle: Presentation / Scientific */}
        <div className="flex items-center gap-2 mb-4">
          <Button
            variant={currentVariant === 'presentation' ? 'default' : 'outline'}
            size="sm"
            aria-pressed={currentVariant === 'presentation'}
            data-active={currentVariant === 'presentation'}
            onClick={() => setCurrentVariant('presentation')}
          >
            Presentation
          </Button>
          <Button
            variant={currentVariant === 'scientific' ? 'default' : 'outline'}
            size="sm"
            aria-pressed={currentVariant === 'scientific'}
            data-active={currentVariant === 'scientific'}
            disabled={!data.has_scientific_png}
            onClick={() => {
              if (data.has_scientific_png) {
                setCurrentVariant('scientific')
              }
            }}
            title={!data.has_scientific_png ? 'No scientific PNG available' : undefined}
          >
            Scientific
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* PNG image (fetched with auth, displayed via blob URL) */}
          <Card>
            <CardContent className="p-4">
              {blobUrl ? (
                <img
                  src={blobUrl}
                  alt={`Batch image ${data.index}: ${data.filename}`}
                  className="w-full rounded-lg"
                />
              ) : (
                <div className="h-64 bg-muted animate-pulse rounded-lg" />
              )}
            </CardContent>
          </Card>

          {/* Metrics or Error — distinguished by quality when available */}
          <div className="space-y-4">
            <ImageDetailPanel data={data} />
          </div>
        </div>
      </div>
  )
}

// ---------------------------------------------------------------------------
// Quality-aware detail panel (T5.2 fraktal-bisection-ux)
// ---------------------------------------------------------------------------

/** Map failure_reason to user-facing explanation */
const FAILURE_MESSAGES: Record<string, string> = {
  no_sign_change:
    'Geometría no analizable (modelo). La proyección está fuera del dominio de Granulated 2012.',
  iteration_limit:
    'No convergió (ruido o calidad de imagen).',
  kf_negative: 'Resultado no físico (kf < 0).',
}

function ImageDetailPanel({ data }: { data: ImageDetailData }) {
  const quality = data.quality

  // Legacy path: no quality field → use old error/metrics split
  if (!quality) {
    return data.error ? (
      <LegacyErrorPanel data={data} />
    ) : (
      <ConvergedMetricsPanel data={data} />
    )
  }

  switch (quality) {
    case 'converged':
      return <ConvergedMetricsPanel data={data} />

    case 'approximate':
      return (
        <>
          {data.quality && <QualityBadge quality={data.quality} className="mb-2" />}
          <Card className="border-yellow-300 bg-yellow-50">
            <CardHeader>
              <CardTitle className="text-yellow-800">Approximate Result</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Df aproximado</dt>
                <dd className="font-mono">
                  {data.df_estimate !== null && data.df_estimate !== undefined
                    ? data.df_estimate.toFixed(3)
                    : '—'}
                </dd>
                <dt className="text-muted-foreground">Residual</dt>
                <dd className="font-mono">
                  {data.bisection_residual !== null && data.bisection_residual !== undefined
                    ? data.bisection_residual.toFixed(3)
                    : '—'}
                </dd>
              </dl>
              <p className="mt-3 text-sm text-yellow-800">
                Df aproximado, residual{' '}
                {data.bisection_residual !== null && data.bisection_residual !== undefined
                  ? data.bisection_residual.toFixed(3)
                  : '?'}
                . Resultado de calidad limitada.
              </p>
            </CardContent>
          </Card>
          <DiagnosticInfoCard data={data} />
        </>
      )

    case 'excluded':
      return (
        <>
          {data.quality && <QualityBadge quality={data.quality} className="mb-2" />}
          <Card className="border-gray-300 bg-gray-50">
            <CardHeader>
              <CardTitle className="text-gray-700">Excluded</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700">
                {data.failure_reason
                  ? FAILURE_MESSAGES[data.failure_reason] ?? data.failure_reason
                  : 'Image excluded from analysis.'}
              </p>
            </CardContent>
          </Card>
          <DiagnosticInfoCard data={data} />
        </>
      )

    case 'failed':
      // kf_negative with categorized failure_reason
      if (data.failure_reason && data.failure_reason !== null) {
        return (
          <>
            {data.quality && <QualityBadge quality={data.quality} className="mb-2" />}
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Analysis Failed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-destructive">
                  {FAILURE_MESSAGES[data.failure_reason] ?? data.failure_reason}
                </p>
                {data.df_estimate !== null && data.df_estimate !== undefined && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Best Df estimate: {data.df_estimate.toFixed(3)}
                  </p>
                )}
              </CardContent>
            </Card>
            <DiagnosticInfoCard data={data} />
          </>
        )
      }
      // Engine crash (null failure_reason) → show raw error
      return <LegacyErrorPanel data={data} />

    default:
      return <LegacyErrorPanel data={data} />
  }
}

function ConvergedMetricsPanel({ data }: { data: ImageDetailData }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Fractal Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Df</dt>
            <dd className="font-mono">
              {data.fractal_dimension !== null
                ? data.fractal_dimension.toFixed(3)
                : '—'}
            </dd>

            <dt className="text-muted-foreground">kf</dt>
            <dd className="font-mono">
              {data.prefactor !== null ? data.prefactor.toFixed(3) : '—'}
            </dd>

            <dt className="text-muted-foreground">R²</dt>
            <dd className="font-mono">
              {data.r_squared !== null ? data.r_squared.toFixed(3) : '—'}
            </dd>

            <dt className="text-muted-foreground">Particles</dt>
            <dd className="font-mono">
              {data.n_particles_counted ?? '—'}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">DPO Used</dt>
            <dd className="font-mono">{data.dpo_used.toFixed(1)}</dd>
          </dl>
        </CardContent>
      </Card>
    </>
  )
}

function LegacyErrorPanel({ data }: { data: ImageDetailData }) {
  return (
    <>
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Analysis Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">{data.error}</p>
        </CardContent>
      </Card>
      <DiagnosticInfoCard data={data} />
    </>
  )
}

function DiagnosticInfoCard({ data }: { data: ImageDetailData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagnostic Info</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">DPO Used</dt>
          <dd className="font-mono">{data.dpo_used.toFixed(1)}</dd>

          <dt className="text-muted-foreground">Azimuth</dt>
          <dd className="font-mono">
            {data.azimuth !== null ? data.azimuth.toFixed(1) : '—'}
          </dd>

          <dt className="text-muted-foreground">Elevation</dt>
          <dd className="font-mono">
            {data.elevation !== null ? data.elevation.toFixed(1) : '—'}
          </dd>

          <dt className="text-muted-foreground">px/100nm</dt>
          <dd className="font-mono">{data.pixels_per_100nm.toFixed(1)}</dd>

          <dt className="text-muted-foreground">Autocalibrate</dt>
          <dd className="font-mono">{data.autocalibrate_source ?? '—'}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}
