'use client'

/**
 * Batch FRAKTAL analysis page (T4.5, change: fraktal-batch-analysis).
 *
 * Composes the upload form (client-side metadata detection + submission)
 * with the results view (stats / histogram / per-image table / Sorensen
 * comparison). State is held locally: once a batch completes we swap the
 * upload UI out for the results UI, with a "analyze another batch" button
 * that resets back to the form.
 */
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/Header'
import { FraktalBatchUpload } from '@/components/fraktal/FraktalBatchUpload'
import { FraktalBatchResultsView } from '@/components/fraktal/FraktalBatchResultsView'
import type { FraktalBatchResult } from '@/lib/api'

export default function FraktalBatchPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const [result, setResult] = useState<FraktalBatchResult | null>(null)

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Breadcrumb back to single-image FRAKTAL */}
        <Link
          href={`/projects/${id}/fraktal/new`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to single-image FRAKTAL
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Batch FRAKTAL Analysis</h1>
          <p className="text-muted-foreground mt-2">
            Upload a ZIP of projection images. Auto-calibration is applied when
            the ZIP carries metadata from a pyaglogen3D export; otherwise
            provide pixels per 100 nm manually.
          </p>
        </div>

        {!result ? (
          <FraktalBatchUpload projectId={id} onSuccess={setResult} />
        ) : (
          <div className="space-y-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResult(null)}
            >
              Analyze another batch
            </Button>
            <FraktalBatchResultsView result={result} />
          </div>
        )}
      </main>
    </div>
  )
}
