'use client'

import Link from 'next/link'
import { Layers, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/kit/EmptyState'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'
import { StatusChip } from '@/components/kit/StatusChip'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { formatDistanceToNow } from '@/lib/utils'
import type { FraktalBatchListItem } from '@/lib/api'

/**
 * The FRAKTAL batches of one project, on the design-system kit (issue #174).
 *
 * A batch is a set of images analysed together, so what a researcher needs
 * from the row is how many images went in, how many survived, and the mean
 * dimension they produced together with the batch's own state.
 *
 * The image count stays a Badge rather than a Num: it labels the batch the
 * way the algorithm chip does, and it is not a reading the engine produced.
 */
interface FraktalBatchesSectionProps {
  projectId: string
  batches: FraktalBatchListItem[] | undefined
  isLoading: boolean
}

export function FraktalBatchesSection({
  projectId,
  batches,
  isLoading,
}: FraktalBatchesSectionProps) {
  return (
    <Panel
      title="FRAKTAL batches"
      hint="Image sets analysed together, with the aggregate statistics of the surviving images."
      className="mt-8"
    >
      {isLoading ? (
        <LoadingScreen message="Loading batches..." />
      ) : !batches || batches.length === 0 ? (
        <EmptyState
          icon={Layers}
          headingLevel={3}
          title="No FRAKTAL batches yet"
          description="Upload a ZIP of projection images for batch fractal analysis"
          action={
            <Link href={`/projects/${projectId}/fraktal/new`}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Upload Batch
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4">
          {batches.map((batch) => (
            <Link
              key={batch.id}
              href={`/projects/${projectId}/fraktal/batch/${batch.id}`}
              className="block"
            >
              <article className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-brand">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink">
                          {batch.algorithm === 'granulated_2012'
                            ? 'Granulated 2012'
                            : 'Voxel 2018'}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {batch.n_images} images
                        </Badge>
                        <StatusChip status={batch.status} />
                      </div>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {formatDistanceToNow(batch.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {batch.mean_df != null && (
                      <div className="text-right text-[11px] leading-relaxed">
                        <p className="m-0 flex items-baseline justify-end gap-1.5">
                          <span className="text-ink-muted">Df mean</span>
                          <Num value={batch.mean_df} digits={3} size="sm" />
                        </p>
                        {batch.n_successful != null && (
                          <p className="m-0 flex items-baseline justify-end gap-1 text-ink-muted">
                            <Num value={batch.n_successful} digits={0} size="sm" />
                            <span>/</span>
                            <Num value={batch.n_images} digits={0} size="sm" />
                            <span>successful</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  )
}
