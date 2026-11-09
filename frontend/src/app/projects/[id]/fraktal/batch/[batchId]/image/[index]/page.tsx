'use client'

/**
 * Drill-down route page for a single batch image (T5.2, change:
 * fraktal-drilldown-and-csv; re-skinned by issue #176, slice 3B).
 *
 * Bookmarkable URL: /projects/{id}/fraktal/batch/{batchId}/image/{index}
 * Resolves route params and delegates rendering to FraktalBatchImageDetail.
 *
 * The shell draws the app frame — `<main>`, the padding and the capped column —
 * so this route draws none of it, and it never mounted a navigation of its own:
 * that is the shell's job, and the only component that ever offered one,
 * `components/layout/Header.tsx`, is deleted.
 *
 * What that leaves, stated plainly instead of sold as a tidy trade: `AppShell`
 * paints its chrome only when `!chromeless && isAuthenticated && !isLoading`,
 * while the middleware only checks that a session cookie exists. A stale cookie
 * with a rejected token therefore paints this route with no rail and no top
 * bar. That gap predates this route's migration — by the time it landed, no
 * production file rendered the legacy `Header` at all — and it belongs to the
 * shell's chrome decision, not to a page that would have to grow a header of
 * its own to paper over it.
 */
import { FraktalBatchImageDetail } from '@/components/fraktal/FraktalBatchImageDetail'

export default function FraktalBatchImagePage({
  params,
}: {
  params: { id: string; batchId: string; index: string }
}) {
  const { id: projectId, batchId, index } = params
  const imageIndex = parseInt(index, 10)

  return (
    <FraktalBatchImageDetail
      projectId={projectId}
      batchId={batchId}
      index={imageIndex}
    />
  )
}
