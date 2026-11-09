'use client'

/**
 * Batch summary route page (C2 hotfix).
 *
 * Bookmarkable URL: /projects/{id}/fraktal/batch/{batchId}
 * Fetches batch detail independently (not from ephemeral useState) and renders
 * the full batch summary via FraktalBatchSummaryPage.
 *
 * This route resolves the "Back to batch results" link from the drill-down
 * (FraktalBatchImageDetail) and the dashboard batch list links.
 *
 * On the design-system kit (issue #176, slice 3 of 3, part A) this route stops
 * wrapping the summary in a `min-h-screen` div with `Header` on top. The shell
 * owns the frame, the padding and the capped column, so the wrapper only added
 * a second full-height box inside it.
 *
 * `Header` is not "removed because it duplicated the top bar". It could not:
 * `Header` returns null when it is inside the shell. What is given up is the
 * fallback chrome for the sessions where the shell draws none — `showChrome` is
 * `!chromeless && isAuthenticated && !isLoading`, so it is false while
 * `AuthContext` initialises and for a live cookie whose token the server has
 * already rejected. In those two windows this route used to paint its own
 * navigation, and now it paints nothing but the summary. That is the deliberate
 * trade of the migration (navigation belongs to the shell), and it is worth
 * knowing before this comment is read as "there was nothing there".
 */
import { FraktalBatchSummaryPage } from '@/components/fraktal/FraktalBatchSummaryPage'

export default function FraktalBatchDetailPage({
  params,
}: {
  params: { id: string; batchId: string }
}) {
  const { id: projectId, batchId } = params

  return <FraktalBatchSummaryPage projectId={projectId} batchId={batchId} />
}
