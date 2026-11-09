'use client'

/**
 * One FRAKTAL analysis: its result, and the two things a researcher does with
 * a finished record — run it again with the same parameters, or delete it.
 *
 * What the page owns is the frame and the actions. The readings belong to
 * `FraktalResultsView`, which is a neighbour with its own file and its own
 * tests. The shell draws the app frame (`main`, the padding, the capped
 * column), so this route draws none of it: it names the page with `PageHeader`
 * and states a failed load with the same `Callout` shape the rest of the
 * product uses for a failure.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useFraktalAnalysis, useDeleteFraktalAnalysis, useRerunFraktalAnalysis } from '@/hooks/useFraktalAnalyses'
import { FraktalResultsView } from '@/components/fraktal/FraktalResultsView'
import { Callout } from '@/components/kit/Callout'
import { PageHeader } from '@/components/kit/PageHeader'
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
    return <LoadingScreen message="Loading analysis..." />
  }

  if (error || !analysis) {
    return (
      <>
        <PageHeader eyebrow="FRAKTAL" title="FRAKTAL Analysis" />
        <Callout
          tone="danger"
          title="Failed to load analysis"
          action={
            <Link href={`/projects/${id}`}>
              <Button variant="outline">Back to Project</Button>
            </Link>
          }
        >
          It may not exist or the backend is unavailable.
        </Callout>
      </>
    )
  }

  const canRerun = analysis.status === 'completed' || analysis.status === 'failed'

  return (
    <>
      {/* Breadcrumb */}
      <Link
        href={`/projects/${id}`}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {project?.name || 'Project'}
      </Link>

      <PageHeader
        eyebrow="FRAKTAL"
        title="FRAKTAL Analysis"
        description={analysis.model === 'granulated_2012' ? 'Granulated 2012 Model' : 'Voxel 2018 Model'}
        actions={
          <>
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-muted">Delete?</span>
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
          </>
        }
      />

      <FraktalResultsView analysis={analysis} projectId={id} />
    </>
  )
}
