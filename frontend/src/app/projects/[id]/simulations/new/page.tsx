'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useCreateSimulation } from '@/hooks/useSimulations'
import { Header } from '@/components/layout/Header'
import { SimulationForm } from '@/components/forms/SimulationForm'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'
import type { CreateSimulationInput } from '@/lib/types'

export default function NewSimulationPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const router = useRouter()
  const { data: project, isLoading } = useProject(id)
  const createSimulation = useCreateSimulation(id)

  const handleSubmit = async (data: CreateSimulationInput) => {
    try {
      const simulation = await createSimulation.mutateAsync(data)
      router.push(`/projects/${id}/simulations/${simulation.id}`)
    } catch (error) {
      console.error('Failed to create simulation:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header />
        <LoadingScreen message="Loading..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to {project?.name || 'Project'}
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold">New Simulation</h1>
          <p className="text-muted-foreground mt-2">
            Configure and run a 3D agglomerate simulation
          </p>
        </div>

        <SimulationForm
          onSubmit={handleSubmit}
          isLoading={createSimulation.isPending}
        />
      </main>
    </div>
  )
}
