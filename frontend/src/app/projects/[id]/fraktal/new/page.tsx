'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useSimulations } from '@/hooks/useSimulations'
import { useCreateFraktalAnalysis } from '@/hooks/useFraktalAnalyses'
import { FraktalAnalysisForm } from '@/components/fraktal/FraktalAnalysisForm'
import { Callout } from '@/components/kit/Callout'
import { PageHeader } from '@/components/kit/PageHeader'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'
import type { CreateFraktalInput } from '@/lib/types'

/**
 * Where a FRAKTAL analysis starts: name it, point it at an image or at a
 * completed simulation, and set the parameters the model reads.
 *
 * The shell draws the navigation, so this file does not. What that costs is
 * worth stating plainly, because the next page to be ported will copy this
 * shape: `Header` was mounted here to cover the sessions the shell leaves
 * chromeless. `showChrome` is `!chromeless && isAuthenticated && !isLoading`,
 * while the middleware only checks that a session cookie exists — so a stale
 * cookie with a rejected token paints this route with no rail, no top bar and
 * no account link, and `Header` used to be the one way out of it. Dropping it
 * is the migration's deliberate trade (navigation is the shell's job, not this
 * page's); it is not a claim that the two components are equivalent.
 *
 * The column is capped at 672px, the measure `projects/new` and
 * `simulations/new` still use. Left to itself the form stretches to the
 * shell's full 1440px and the two-column rows inside each panel grow to ~650px
 * per cell.
 *
 * Two notices sit on the screen besides the form, and they are not the same
 * kind of thing: the batch-analysis pointer is navigation and reads as a note;
 * a failed request is a failure and reads as an alert, with the server's own
 * reason kept in the sentence so it can be acted on.
 */
export default function NewFraktalAnalysisPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const router = useRouter()
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id)
  const { data: simulations } = useSimulations(id)
  const createAnalysis = useCreateFraktalAnalysis(id)

  const handleSubmit = async (data: CreateFraktalInput) => {
    try {
      const analysis = await createAnalysis.mutateAsync(data)
      router.push(`/projects/${id}/fraktal/${analysis.id}`)
    } catch (err) {
      console.error('Failed to create analysis:', err)
    }
  }

  if (projectLoading) {
    return <LoadingScreen message="Loading project..." />
  }

  if (projectError || !project) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <PageHeader eyebrow="FRAKTAL" title="Project unavailable" />
        <Callout
          tone="danger"
          title="Failed to load project"
          action={
            <Link href="/projects">
              <Button variant="outline">Back to Projects</Button>
            </Link>
          }
        >
          It may not exist or the backend is unavailable.
        </Callout>
      </div>
    )
  }

  // Get completed simulations for the projection source option
  const completedSimulations = (simulations?.results ?? [])
    .filter((sim) => sim.status === 'completed')
    .map((sim) => ({
      id: sim.id,
      algorithm: sim.algorithm,
      status: sim.status,
      created_at: sim.created_at,
    }))

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Breadcrumb */}
      <Link
        href={`/projects/${id}`}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {project.name}
      </Link>

      <PageHeader
        eyebrow="FRAKTAL"
        title="New FRAKTAL Analysis"
        description="Analyze fractal properties of agglomerate images using the FRAKTAL algorithm. Upload an image or generate a projection from a simulation."
      />

      {/* Batch analysis CTA (T4.6) */}
      <Callout tone="info" title="Analyzing a whole simulation?" className="mb-4">
        Have a ZIP of projections from a simulation?{' '}
        <Link
          href={`/projects/${id}/fraktal/batch`}
          className="font-medium underline"
        >
          Try batch analysis
        </Link>{' '}
        for automatic calibration and distribution statistics.
      </Callout>

      {/* Form */}
      <FraktalAnalysisForm
        onSubmit={handleSubmit}
        isLoading={createAnalysis.isPending}
        simulations={completedSimulations}
      />

      {/* Error Display */}
      {createAnalysis.isError && (
        <Callout tone="danger" title="Failed to create analysis" className="mt-4">
          {(createAnalysis.error as Error)?.message || 'Unknown error'}
        </Callout>
      )}
    </div>
  )
}
