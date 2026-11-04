'use client'

/**
 * Drill-down route page for a single batch image (T5.2, change:
 * fraktal-drilldown-and-csv; re-skinned by issue #176, slice 3B).
 *
 * Bookmarkable URL: /projects/{id}/fraktal/batch/{batchId}/image/{index}
 * Resolves route params and delegates rendering to FraktalBatchImageDetail.
 *
 * The shell draws the app frame — `<main>`, the padding and the capped column —
 * so this route draws none of it. It also stopped mounting the legacy `Header`,
 * and what that gives up is worth stating precisely, because the reason is not
 * "a second header would paint two": `Header` renders `null` when the shell is
 * mounted (`useIsInsideAppShell`), so inside the shell it was already inert.
 *
 * What is ceded is the fallback chrome for the sessions the shell leaves
 * chromeless. `AppShell` shows its chrome only when
 * `!chromeless && isAuthenticated && !isLoading`, while the middleware only
 * checks that a session cookie exists — so a stale cookie with a rejected token
 * paints this route with no rail and no top bar, and `Header` was the one way
 * out of it. Dropping it is the migration's deliberate trade, the same one part
 * A of this slice made for the batch route (navigation is the shell's job, not
 * this page's), not a claim that the two are equivalent.
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
