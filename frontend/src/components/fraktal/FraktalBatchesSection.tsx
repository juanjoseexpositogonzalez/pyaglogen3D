'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Layers, Plus } from 'lucide-react'
import { formatDistanceToNow, formatNumber } from '@/lib/utils'
import type { FraktalBatchListItem } from '@/lib/api'

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
    <div className="space-y-4 mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">FRAKTAL Batches</h2>
      </div>

      {isLoading ? (
        <LoadingScreen message="Loading batches..." />
      ) : !batches || batches.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No FRAKTAL batches yet</h3>
            <p className="text-muted-foreground mb-4">
              Upload a ZIP of projection images for batch fractal analysis
            </p>
            <Link href={`/projects/${projectId}/fraktal/new`}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Upload Batch
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {batches.map((batch) => (
            <Link
              key={batch.id}
              href={`/projects/${projectId}/fraktal/batch/${batch.id}`}
            >
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {batch.algorithm === 'granulated_2012'
                              ? 'Granulated 2012'
                              : 'Voxel 2018'}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {batch.n_images} images
                          </Badge>
                          <StatusBadge status={batch.status} />
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDistanceToNow(batch.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {batch.mean_df != null && (
                        <div className="text-right">
                          <p className="text-sm">
                            <span className="text-muted-foreground">
                              Df mean ={' '}
                            </span>
                            <span className="font-mono font-medium">
                              {formatNumber(batch.mean_df, 3)}
                            </span>
                          </p>
                          {batch.n_successful != null && (
                            <p className="text-sm">
                              <span className="text-muted-foreground">
                                {batch.n_successful}/{batch.n_images} successful
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
