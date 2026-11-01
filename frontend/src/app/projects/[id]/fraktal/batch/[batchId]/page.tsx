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
 * wrapping the summary in a `min-h-screen` div with `Header` on top: the shell
 * owns the frame, the padding and the capped column, and a second `Header`
 * duplicated the top bar on every authenticated visit. Nothing else moved —
 * the page still renders one component and owns no state of its own.
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
