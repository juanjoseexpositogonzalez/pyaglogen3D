'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useFraktalAnalysis, useDeleteFraktalAnalysis, useRerunFraktalAnalysis } from '@/hooks/useFraktalAnalyses'
import { Header } from '@/components/layout/Header'
import { FraktalResultsView } from '@/components/fraktal/FraktalResultsView'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react'

export default function FraktalAnalysisDetailPage({
  params,
}: {
  params: { id: string; analysisId: string }
}) {
  const { id, analysisId } = params
  const router = useRouter()
  const { data: project } = useProject(id)
  const { data: analysis, isLoading, error, refetch } = useFraktalAnalysis(id, analysisId)
  const deleteAnalysis = useDeleteFraktalAnalysis(id)
  const rerunAnalysis = useRerunFraktalAnalysis(id)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDelete = async () => {
    try {
      await deleteAnalysis.mutateAsync(analysisId)
      router.push(`/projects/${id}`)
    } catch (err) {
      console.error('Failed to delete analysis:', err)
    }
  }

  const handleRerun = async () => {
    try {
      await rerunAnalysis.mutateAsync(analysisId)
      refetch()
    } catch (err) {
      console.error('Failed to rerun analysis:', err)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <LoadingScreen message="Loading analysis..." />
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <Card className="border-destructive">
            <CardContent className="p-6">
              <p className="text-destructive">
                Failed to load analysis. It may not exist or the backend is unavailable.
              </p>
              <Link href={`/projects/${id}`} className="mt-4 inline-block">
                <Button variant="outline">Back to Project</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const canRerun = analysis.status === 'completed' || analysis.status === 'failed'

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to {project?.name || 'Project'}
        </Link>

        {/* Header with Actions */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">FRAKTAL Analysis</h1>
            <p className="text-muted-foreground mt-1">
              {analysis.model === 'granulated_2012' ? 'Granulated 2012' : 'Voxel 2018'} Model
            </p>
          </div>

          <div className="flex gap-2">
            {canRerun && (
              <Button
                variant="outline"
                onClick={handleRerun}
                disabled={rerunAnalysis.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${rerunAnalysis.isPending ? 'animate-spin' : ''}`} />
                {rerunAnalysis.isPending ? 'Re-running...' : 'Re-run'}
              </Button>
            )}

            {showDeleteConfirm ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">Delete?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteAnalysis.isPending}
                >
                  {deleteAnalysis.isPending ? 'Deleting...' : 'Confirm'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleteAnalysis.isPending}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Results */}
        <FraktalResultsView analysis={analysis} projectId={id} />
      </main>
    </div>
  )
}
