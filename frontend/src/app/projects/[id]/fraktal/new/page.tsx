'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useSimulations } from '@/hooks/useSimulations'
import { useCreateFraktalAnalysis } from '@/hooks/useFraktalAnalyses'
import { Header } from '@/components/layout/Header'
import { FraktalAnalysisForm } from '@/components/fraktal/FraktalAnalysisForm'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'
import type { CreateFraktalInput } from '@/lib/types'

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
    return (
      <div className="min-h-screen">
        <Header />
        <LoadingScreen message="Loading project..." />
      </div>
    )
  }

  if (projectError || !project) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <Card className="border-destructive">
            <CardContent className="p-6">
              <p className="text-destructive">
                Failed to load project. It may not exist or the backend is unavailable.
              </p>
              <Link href="/projects" className="mt-4 inline-block">
                <Button variant="outline">Back to Projects</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
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
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Breadcrumb */}
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to {project.name}
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">New FRAKTAL Analysis</h1>
          <p className="text-muted-foreground mt-2">
            Analyze fractal properties of agglomerate images using the FRAKTAL algorithm.
            Upload an image or generate a projection from a simulation.
          </p>
        </div>

        {/* Form */}
        <FraktalAnalysisForm
          onSubmit={handleSubmit}
          isLoading={createAnalysis.isPending}
          simulations={completedSimulations}
        />

        {/* Error Display */}
        {createAnalysis.isError && (
          <Card className="mt-4 border-destructive">
            <CardContent className="p-4">
              <p className="text-destructive text-sm">
                Failed to create analysis: {(createAnalysis.error as Error)?.message || 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
