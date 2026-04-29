'use client'

/**
 * FraktalBatchSummaryPage — fetches batch detail and renders the results view.
 *
 * Created as part of C2 hotfix: provides a route-driven batch summary that
 * fetches independently from the upload page's ephemeral state.
 *
 * This component is used by the route page at
 * `app/projects/[id]/fraktal/batch/[batchId]/page.tsx`.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { fraktalApi, type FraktalBatchResult } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FraktalBatchResultsView } from './FraktalBatchResultsView'

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
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <p className="text-muted-foreground">Loading batch summary...</p>
        <div className="mt-4 space-y-4">
          <div className="h-32 bg-muted animate-pulse rounded-lg" />
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    )
  }

  // --- Error state ---
  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Card className="border-destructive">
          <CardContent className="p-6">
            <p className="text-destructive">
              Failed to load batch. {error}
            </p>
            <Link
              href={`/projects/${projectId}`}
              className="mt-4 inline-block"
            >
              <Button variant="outline" aria-label="Back to project">
                Back to project
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Link
        href={`/projects/${projectId}`}
        className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        aria-label="Back to project"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to project
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Batch Summary</h1>
      </div>

      <FraktalBatchResultsView
        result={data}
        projectId={projectId}
        batchId={batchId}
        onDeleted={() => router.push(`/projects/${projectId}`)}
      />
    </div>
  )
}
