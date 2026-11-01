'use client'

/**
 * FraktalBatchSummaryPage — fetches batch detail and renders the results view.
 *
 * Created as part of C2 hotfix: provides a route-driven batch summary that
 * fetches independently from the upload page's ephemeral state.
 *
 * This component is used by the route page at
 * `app/projects/[id]/fraktal/batch/[batchId]/page.tsx`.
 *
 * On the design-system kit (issue #176, slice 3 of 3, part A). What it does is
 * unchanged: one request on mount, cancelled on unmount, the same three states
 * and the same hand-off to `FraktalBatchResultsView` and
 * `FraktalBatchDistributions`. What changed:
 *
 * 1. `PageHeader` names the page instead of a bare `h1`. The eyebrow says which
 *    part of the product this belongs to; the title is the same two words.
 * 2. A failed load is a `Callout tone="danger"` instead of a card with a
 *    destructive border, so the failure is announced (`role="alert"`) and the
 *    server's own reason is kept beside the sentence that says what failed.
 *    The sentence keeps the period it always had ("Failed to load batch."),
 *    which reads oddly at the end of a callout title and is not mine to change.
 * 3. The distributions block is a `Panel` inside the `<section>` that names it.
 *    The section's `aria-label` is "Distributions" — the same words as the
 *    panel's visible `h2`, because a landmark whose name the page never shows
 *    cannot be reached by anyone speaking the words on the screen. The two are
 *    deliberately not merged: `Panel` renders its own `<section>`, which
 *    without a name is not a landmark at all.
 * 4. The loading placeholder keeps its two skeleton blocks, now drawn with
 *    `bg-surface-strong` instead of the legacy `bg-muted`, because a skeleton
 *    reserves the layout the result will occupy and a spinner does not.
 *
 * The error state's only way out is a bare `Link` wearing `buttonVariants()`,
 * not a `Link` wrapping a `Button`: an <a> around a <button> is invalid nesting
 * and gives one destination two tab stops. Same pattern as the compare screen.
 *
 * The column is capped at 1024px, the measure the page always had. The shell
 * owns the padding and the outer 1440px frame.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { fraktalApi, type FraktalBatchResult } from '@/lib/api'
import { buttonVariants } from '@/components/ui/button'
import { Callout } from '@/components/kit/Callout'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { FraktalBatchResultsView } from './FraktalBatchResultsView'
import { FraktalBatchDistributions } from './FraktalBatchDistributions'

interface Props {
  projectId: string
  batchId: string
}

export function FraktalBatchSummaryPage({ projectId, batchId }: Props) {
  const router = useRouter()
  const [data, setData] = useState<FraktalBatchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    fraktalApi
      .getBatch(projectId, batchId)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load batch')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId, batchId])

  // --- Loading state ---
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-ink-muted">Loading batch summary...</p>
        <div className="mt-4 space-y-4">
          <div className="h-32 animate-pulse rounded-lg bg-surface-strong" />
          <div className="h-64 animate-pulse rounded-lg bg-surface-strong" />
        </div>
      </div>
    )
  }

  // --- Error state ---
  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Callout
          tone="danger"
          title="Failed to load batch."
          action={
            <Link
              href={`/projects/${projectId}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              Back to project
            </Link>
          }
        >
          {error}
        </Callout>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href={`/projects/${projectId}`}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to project
      </Link>

      <PageHeader eyebrow="FRAKTAL" title="Batch Summary" />

      {/* Frente 9: persistent distributions for Df/kf/Rg/npo. */}
      <section className="mb-6" aria-label="Distributions">
        <Panel
          title="Distributions"
          hint="Df, kf, Rg and particle count across the images of this batch."
        >
          <FraktalBatchDistributions
            images={data.images}
            stats={data.stats}
            studyComparison={data.study_comparison ?? null}
          />
        </Panel>
      </section>

      <FraktalBatchResultsView
        result={data}
        projectId={projectId}
        batchId={batchId}
        onDeleted={() => router.push(`/projects/${projectId}`)}
        onResultUpdate={setData}
      />
    </div>
  )
}
