'use client'

/**
 * Drill-down route page for a single batch image (T5.2, change:
 * fraktal-drilldown-and-csv).
 *
 * Bookmarkable URL: /projects/{id}/fraktal/batch/{batchId}/image/{index}
 * Resolves route params and delegates rendering to FraktalBatchImageDetail.
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
