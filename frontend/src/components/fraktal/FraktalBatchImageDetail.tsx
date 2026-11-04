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
 *
 * What a review asked for, and what the screen now does:
 *
 * 1. The `h1` carries the file name again (`Image 2 — proj_002.png`). It had
 *    lost it to the description line; the title is what a reader scans for the
 *    file they came to look at.
 * 2. The figure caption sits in its own row of the plate instead of a veil over
 *    the bottom edge of the image, and it no longer repeats the identity the
 *    header gives: it carries the variant on screen and the scale it is read at.
 * 3. The readings are `DetailList`, the kit's own label/value list, instead of a
 *    private copy of it in this file.
 * 4. The loading state is skeleton blocks that reserve the plate and the
 *    readings, not `LoadingScreen`: a spinner does not hold the layout, so the
 *    page jumped when the image arrived.
 *
 * One copy change is declared rather than passed over: the sentence added to the
 * approximate-result callout is English, while the two labels inside it — "Df
 * aproximado" and "Residual" — and the failure messages in `FAILURE_MESSAGES`
 * are Spanish. Those strings are the engine's vocabulary, they predate this
 * slice and its tests pin them verbatim; unifying the panel's language is a copy
 * change that needs its own decision, not a silent rewrite inside a re-skin.
 */
import { useCallback, useEffect, useState } from 'react'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Callout } from '@/components/kit/Callout'
import { DetailList } from '@/components/kit/DetailList'
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
 * The pair the figure caption is drawn with.
 *
 * Neither member is an ink token. The caption is part of the plate, and the
 * plate is deliberately theme-invariant, so an ink that flipped with the theme
 * would be the one thing on that surface that did: `--ink` is near-black on
 * light paper and near-white on dark paper, and against a fixed 50% grey one of
 * the two would be unreadable.
 *
 * The scrim is not decoration: it is what gives the ink a background of its own
 * instead of leaving the ratio to the plate alone. Measured over the plate it
 * composites to #1d272f, where the ink measures 14.4:1; on the bare plate the
 * same ink would measure 3.75:1, under AA for 11px text.
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
  // A spinner says that something is happening; it does not say how much room
  // the answer takes, so the page jumps when the image arrives. These blocks
  // reserve the plate and the readings. Same shape as the batch summary route,
  // which settled this in part A of the slice.
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-ink-muted">Loading image detail...</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-[340px] animate-pulse rounded-lg bg-surface-strong" />
          <div className="grid gap-4">
            <div className="h-32 animate-pulse rounded-lg bg-surface-strong" />
            <div className="h-32 animate-pulse rounded-lg bg-surface-strong" />
          </div>
        </div>
      </div>
    )
  }

  // --- Error state (metadata fetch failed or no data) ---
  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <EmptyState
          icon={ImageOff}
          headingLevel={2}
          title="Failed to load image detail"
          description={error ?? 'This image has no readable record.'}
          action={
            // A link wearing the button's clothes, not a button inside a link:
            // an <a> around a <button> is invalid nesting and gives one
            // destination two tab stops. Same shape as the batch summary route.
            <Link
              href={batchUrl}
              className={buttonVariants({ variant: 'outline' })}
            >
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
              Back to batch results
            </Link>
          }
        />
      </div>
    )
  }

  // --- Image fetch error (PNG auth failed, e.g. 401/404) ---
  if (imageError) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <EmptyState
          icon={ImageOff}
          headingLevel={2}
          title="Failed to load image"
          description={imageError}
          action={
            <Link
              href={batchUrl}
              className={buttonVariants({ variant: 'outline' })}
            >
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
              Back to batch results
            </Link>
          }
        />
      </div>
    )
  }

  const pngUrl = fraktalApi.getBatchImagePngUrl(projectId, batchId, index)
  const variantLabel = currentVariant === 'scientific' ? 'Scientific (binary)' : 'Presentation'

  return (
    // 1024px, the measure this page always had and the one the sibling batch
    // route keeps. The shell frames at 1440; a two-column reading layout does
    // not want that much line length, and the plate stretched with it.
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href={batchUrl}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to batch results
      </Link>

      <PageHeader
        eyebrow="FRAKTAL · BATCH IMAGE"
        title={`Image ${data.index} — ${data.filename}`}
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
              className={buttonVariants({ variant: 'outline' })}
            >
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              Download PNG
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
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
            Previous
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
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
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
          <figure
            data-testid="micrograph-plate"
            className="m-0 flex min-h-[240px] flex-col overflow-hidden rounded-md"
            style={{ backgroundColor: MICROGRAPH_PLATE }}
          >
            <div className="flex flex-1 items-center justify-center p-3">
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
            </div>

            {/*
              The figure caption sits in its own row of the plate instead of
              floating over the image: a veil at the bottom edge eats the part of
              the micrograph a reader is most likely to be looking at, and there
              was no way to dismiss it. It carries the two facts the plate cannot
              say by itself — which variant is on screen, and the scale it is read
              at — and none of the identity the page header already gives.

              One string, not `Num` siblings: this is a figure annotation, and
              the readings below stay the `Num` ones.
            */}
            <figcaption
              data-testid="micrograph-caption"
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-1.5"
              style={PLATE_CAPTION}
            >
              <span className="text-[10px] font-extrabold uppercase tracking-[0.08em]">
                {variantLabel}
              </span>
              <span className="num text-[11px]">{`${data.pixels_per_100nm.toFixed(1)} px/100nm · dpo ${data.dpo_used.toFixed(1)} nm`}</span>
            </figcaption>
          </figure>
        </Panel>

        {/* Readings, or the state of the analysis that produced them. */}
        <div className="grid gap-4">
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
          <Callout tone="warning" title="Approximate result">
            <DetailList
              items={[
                { label: 'Df aproximado', value: data.df_estimate, digits: 3 },
                { label: 'Residual', value: data.bisection_residual, digits: 3 },
              ]}
            />
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
        <DetailList
          items={[
            { label: 'kf', value: data.prefactor, digits: 3 },
            { label: 'Particles', value: data.n_particles_counted, digits: 0 },
          ]}
        />
      </Panel>

      <Panel title="Calibration">
        <DetailList
          items={[{ label: 'DPO Used', value: data.dpo_used, digits: 1, unit: 'nm' }]}
        />
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
      <DetailList
        items={[
          { label: 'DPO Used', value: data.dpo_used, digits: 1, unit: 'nm' },
          { label: 'Azimuth', value: data.azimuth, digits: 1, unit: '°' },
          { label: 'Elevation', value: data.elevation, digits: 1, unit: '°' },
          { label: 'px/100nm', value: data.pixels_per_100nm, digits: 1 },
          {
            label: 'Autocalibrate',
            value: <span className="num text-[12px]">{data.autocalibrate_source ?? '—'}</span>,
          },
        ]}
      />
    </Panel>
  )
}
