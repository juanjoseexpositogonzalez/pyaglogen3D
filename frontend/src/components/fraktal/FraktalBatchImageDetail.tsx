'use client'

/**
 * FraktalBatchImageDetail — drill-down view for a single image in a batch
 * (T5.3 + T5.4 + T5.5, change: fraktal-drilldown-and-csv; re-skinned on the
 * design-system kit by issue #176, slice 3B).
 *
 * What it renders has not changed: the PNG fetched with the bearer token and
 * shown through a blob URL, the per-image readings (Df, kf, R², particles,
 * dpo), the quality-aware error states, prev/next navigation with the arrow
 * keys, the Presentation/Scientific variant switch, the authenticated PNG
 * download, the re-analyze button and the back link. What changed is who owns
 * the presentation: `PageHeader` names the plate, each state is a `Callout`
 * whose tone never carries the meaning alone, every reading goes through `Num`
 * (value and unit as siblings, never one concatenated string), the Df is a
 * `MetricCard` because a dimension without its fit quality is a number without
 * a claim, and the two failure states are `EmptyState`s.
 *
 * Why the micrograph is not on `VisualPanel`
 * ------------------------------------------
 * `VisualPanel` keeps its stage near-black in both themes, and that is right
 * for a point cloud: geometry is abstract and a dark stage makes it stand out
 * from the light chrome. A micrograph is not abstract. It is a real image with
 * its own tones, and it is read rather than merely recognised, so the surface
 * behind it must not shift the tones it is judged by. Issue #176 puts it in its
 * acceptance test: images and their overlays are looked at in both themes, and
 * a dark background behind a micrograph is not neutral.
 *
 * So the image hangs on a `Panel` — the theme's own surface, which frames it —
 * around a plate whose colour is declared inline and is therefore identical in
 * both themes. `MICROGRAPH_PLATE` and `OVERLAY_*` below carry the reasoning and
 * the measured contrasts for that decision.
 *
 * One deviation from #176 is declared rather than left to review: `StatusChip`
 * is not used anywhere in this slice. The payload of a batch image has no job
 * status — a finished batch has no per-image status, only a `quality` — and
 * `QualityBadge` is the chip the kit provides for exactly that union. Mapping a
 * quality onto `SimulationStatus` to get the other chip would be the "job
 * finished" / "number usable" conflation the kit warns about.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  RefreshCw,
} from 'lucide-react'

import { fraktalApi, type FraktalBatchImageDetail as ImageDetailData } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { QualityBadge } from '@/components/kit/QualityBadge'

interface Props {
  projectId: string
  batchId: string
  index: number
}

// ---------------------------------------------------------------------------
// The plate, and the pair drawn over it
// ---------------------------------------------------------------------------

/**
 * The surface the micrograph is read on: sRGB mid-grey.
 *
 * It is declared inline — not as a utility class and not as a token — for one
 * reason: it must not follow `[data-theme]`. Every neutral the kit owns is a
 * token that swaps with the theme by design, and `globals.css` is outside this
 * slice's editable surface, so the value is stated here with the measurements
 * that chose it:
 *
 *   - Neutral in the literal sense (R = G = B). The kit's neutrals are
 *     teal-tinted (`--canvas`, the ink ramp); a tinted surround would colour
 *     the greyscale image it frames.
 *   - Mid-tone: 50% sRGB, relative luminance 0.216. A 50% grey surround is the
 *     classic surround for monochrome image reading (DICOM/AAPM TG18): a light
 *     surround darkens the perceived image, a dark one lightens it, so holding
 *     the surround fixed is what makes the two themes comparable.
 *   - Both poles of a binary (scientific) micrograph stay distinguishable from
 *     it — white measures 3.95:1 and black 5.32:1 against #808080 — so the
 *     image's own extent never dissolves into the plate. A white plate would
 *     measure 1:1 against the white pixels of that same image.
 *   - It reads as a surface rather than a hole in both themes: 3.95:1 against
 *     `--surface-strong` in light, 3.91:1 against it in dark.
 */
const MICROGRAPH_PLATE = '#808080'

/**
 * The pair the caption over the image is drawn with.
 *
 * A mark drawn over a micrograph has the image behind it, not the interface, so
 * neither member is an ink token: `--ink` is near-black on light paper and
 * near-white on dark paper, and a caption that flipped with the theme would
 * vanish over whichever half of the images happened to match it.
 *
 * The scrim is not decoration. It is what gives the ink a background of its
 * own, so the ratio does not depend on what the image holds at that corner.
 * Measured: over pure white (the worst case for a light micrograph) the scrim
 * composites to #343e46, where the ink measures 10.4:1; over pure black it
 * composites to #061018 and 18.2:1. The ink on the bare plate would be 3.75:1,
 * under AA for 11px text, which is exactly the job the scrim does.
 */
const OVERLAY_INK = '#f5fafa'
const OVERLAY_SCRIM = 'rgba(7, 20, 29, 0.82)'

/**
 * What the plate shows while the authenticated PNG is on its way.
 *
 * A translucent white from the same fixed family as the overlay, for the same
 * reason: it is drawn on the plate, so a themed surface token would be a
 * rectangle of interface colour sitting on top of an image.
 */
const PLATE_PLACEHOLDER = 'rgba(255, 255, 255, 0.18)'

/** The caption's two members, applied together wherever the overlay is drawn. */
const PLATE_CAPTION = {
  color: OVERLAY_INK,
  backgroundColor: OVERLAY_SCRIM,
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
      // Backend returns { id, status } — frente 6 contract.
      const { id } = await fraktalApi.reanalyzeBatchImage(
        projectId,
        batchId,
        index
      )
      router.push(`/projects/${projectId}/fraktal/${id}`)
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
    return <LoadingScreen message="Loading image detail..." />
  }

  // --- Error state (metadata fetch failed or no data) ---
  if (error || !data) {
    return (
      <EmptyState
        icon={ImageOff}
        headingLevel={2}
        title="Failed to load image detail"
        description={error ?? 'This image has no readable record.'}
        action={
          <Link href={batchUrl}>
            <Button variant="outline" aria-label="Back to batch results">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to batch results
            </Button>
          </Link>
        }
      />
    )
  }

  // --- Image fetch error (PNG auth failed, e.g. 401/404) ---
  if (imageError) {
    return (
      <EmptyState
        icon={ImageOff}
        headingLevel={2}
        title="Failed to load image"
        description={imageError}
        action={
          <Link href={batchUrl}>
            <Button variant="outline" aria-label="Back to batch results">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to batch results
            </Button>
          </Link>
        }
      />
    )
  }

  const pngUrl = fraktalApi.getBatchImagePngUrl(projectId, batchId, index)
  const variantLabel = currentVariant === 'scientific' ? 'Scientific (binary)' : 'Presentation'

  return (
    <>
      <Link
        href={batchUrl}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
        aria-label="Back to batch results"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to batch results
      </Link>

      <PageHeader
        eyebrow="FRAKTAL · BATCH IMAGE"
        title={`Image ${data.index}`}
        description={<span className="num">{data.filename}</span>}
        meta={
          <>
            {/*
              Only the converged state carries a chip up here. The other three
              are stated — and explained — by the `Callout` immediately below,
              whose title and icon are the state; repeating it in a chip would
              also repeat the failure message in the badge's sr-only reason.
            */}
            {data.quality === 'converged' && <QualityBadge quality="converged" />}
            {data.analysis_input_variant && (
              <Badge variant="outline">
                {`Analysis input: ${
                  data.analysis_input_variant === 'scientific'
                    ? 'Scientific (binary)'
                    : 'Presentation'
                }`}
              </Badge>
            )}
            {data.batch_origin && (
              <Badge variant="outline">
                {`Origin: ${
                  data.batch_origin === 'simulation' ? 'From Simulation' : 'External upload'
                }`}
              </Badge>
            )}
          </>
        }
        actions={
          <>
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
              <RefreshCw className={`h-4 w-4 mr-2 ${reanalyzing ? 'animate-spin' : ''}`} />
              {reanalyzing ? 'Re-analyzing...' : 'Re-analyze'}
            </Button>
          </>
        }
      />

      {/* Prev / Next navigation */}
      <div className="mb-5 flex items-center justify-between gap-3">
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
          <Button variant="outline" size="sm" disabled aria-label="Previous image">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
        )}

        <span className="text-[12px] text-ink-muted">Image {data.index} of batch</span>

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
          <Button variant="outline" size="sm" disabled aria-label="Next image">
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* The micrograph: a real image on a plate that does not follow the
            theme — see MICROGRAPH_PLATE and OVERLAY_* above. */}
        <Panel
          title="Micrograph"
          hint="The image the analysis was run on. Presentation is the source image; Scientific is the binary-thresholded input the engine can be fed instead."
          action={
            <div className="flex flex-wrap items-center gap-2">
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
          }
        >
          <div
            data-testid="micrograph-plate"
            className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-md p-3"
            style={{ backgroundColor: MICROGRAPH_PLATE }}
          >
            {blobUrl ? (
              <img
                src={blobUrl}
                alt={`Batch image ${data.index}: ${data.filename}`}
                className="max-h-[520px] w-full rounded-md object-contain"
              />
            ) : (
              <div
                className="h-56 w-full animate-pulse rounded-md"
                style={{ backgroundColor: PLATE_PLACEHOLDER }}
              />
            )}

            {/* Figure caption, drawn over the image in the fixed pair. */}
            <div
              data-testid="micrograph-caption"
              className="pointer-events-none absolute inset-x-3 bottom-3 flex items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5"
              style={PLATE_CAPTION}
            >
              <span className="num text-[11px]">{`Image ${data.index}`}</span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.08em]">
                {variantLabel}
              </span>
            </div>
          </div>
        </Panel>

        {/* Readings, or the state of the analysis that produced them. */}
        <div className="grid gap-4">
          <ImageDetailPanel data={data} />
        </div>
      </div>
    </>
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

/**
 * One label/reading pair of a panel.
 *
 * `DetailList` would be the kit's answer, but it is outside this slice's
 * surface; a `<div>` grouping one `<dt>`/`<dd>` inside a `<dl>` is the same
 * shape (HTML5 allows the grouping element) without reaching for it.
 */
function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[13px] text-ink">{children}</dd>
    </div>
  )
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
          <Callout tone="warning" title="Approximate result">
            <dl className="m-0">
              <Readout label="Df aproximado">
                <Num value={data.df_estimate} digits={3} />
              </Readout>
              <Readout label="Residual">
                <Num value={data.bisection_residual} digits={3} />
              </Readout>
            </dl>
            <p className="mt-2 mb-0">
              The bisection settled between two bounds instead of on a sign change. The
              dimension is usable with that caveat, not as a converged measurement.
            </p>
          </Callout>
          <DiagnosticInfoCard data={data} />
        </>
      )

    case 'excluded':
      return (
        <>
          {/* The failure reason is the whole message: a generic "excluded"
              hides whether the geometry was out of the model's domain or the
              exposure was too noisy to threshold. */}
          <Callout tone="info" title="Excluded">
            {data.failure_reason
              ? FAILURE_MESSAGES[data.failure_reason] ?? data.failure_reason
              : 'Image excluded from analysis.'}
          </Callout>
          <DiagnosticInfoCard data={data} />
        </>
      )

    case 'failed':
      // kf_negative with categorized failure_reason
      if (data.failure_reason && data.failure_reason !== null) {
        return (
          <>
            <Callout tone="danger" title="Analysis Failed">
              <p className="m-0">
                {FAILURE_MESSAGES[data.failure_reason] ?? data.failure_reason}
              </p>
              {data.df_estimate !== null && data.df_estimate !== undefined && (
                <p className="mt-2 mb-0 flex items-baseline gap-1.5">
                  <span>Best Df estimate:</span>
                  <Num value={data.df_estimate} digits={3} size="sm" />
                </p>
              )}
            </Callout>
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
      {/* The headline reading. Its detail is the estimator that produced it:
          a dimension on its own says nothing about how well it was fitted. */}
      <MetricCard
        kind="measured"
        label="Df (fractal dimension)"
        value={data.fractal_dimension}
        digits={3}
        sigma={null}
        detail={
          <>
            box counting · R²{' '}
            <Num value={data.r_squared} digits={3} size="sm" />
          </>
        }
      />

      <Panel title="Fractal Metrics">
        <dl className="m-0">
          <Readout label="kf">
            <Num value={data.prefactor} digits={3} />
          </Readout>
          <Readout label="Particles">
            <Num value={data.n_particles_counted} digits={0} />
          </Readout>
        </dl>
      </Panel>

      <Panel title="Calibration">
        <dl className="m-0">
          <Readout label="DPO Used">
            <Num value={data.dpo_used} digits={1} unit="nm" />
          </Readout>
        </dl>
      </Panel>
    </>
  )
}

function LegacyErrorPanel({ data }: { data: ImageDetailData }) {
  return (
    <>
      <Callout tone="danger" title="Analysis Error">
        {data.error}
      </Callout>
      <DiagnosticInfoCard data={data} />
    </>
  )
}

function DiagnosticInfoCard({ data }: { data: ImageDetailData }) {
  return (
    <Panel title="Diagnostic Info">
      <dl className="m-0">
        <Readout label="DPO Used">
          <Num value={data.dpo_used} digits={1} unit="nm" />
        </Readout>
        <Readout label="Azimuth">
          <Num value={data.azimuth} digits={1} unit="°" />
        </Readout>
        <Readout label="Elevation">
          <Num value={data.elevation} digits={1} unit="°" />
        </Readout>
        <Readout label="px/100nm">
          <Num value={data.pixels_per_100nm} digits={1} />
        </Readout>
        <Readout label="Autocalibrate">
          <span className="num text-[12px]">{data.autocalibrate_source ?? '—'}</span>
        </Readout>
      </dl>
    </Panel>
  )
}
