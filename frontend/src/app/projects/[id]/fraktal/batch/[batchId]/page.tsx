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
 */
import { Header } from '@/components/layout/Header'
import { FraktalBatchSummaryPage } from '@/components/fraktal/FraktalBatchSummaryPage'

export default function FraktalBatchDetailPage({
  params,
}: {
  params: { id: string; batchId: string }
}) {
  const { id: projectId, batchId } = params

  return (
    <div className="min-h-screen">
      <Header />
      <FraktalBatchSummaryPage projectId={projectId} batchId={batchId} />
    </div>
  )
}
