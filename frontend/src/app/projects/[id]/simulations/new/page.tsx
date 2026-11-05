'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useProject } from '@/hooks/useProjects'
import { useCreateSimulation } from '@/hooks/useSimulations'
import { SimulationForm } from '@/components/forms/SimulationForm'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/kit/PageHeader'
import type { CreateSimulationInput } from '@/lib/types'

/**
 * Where a simulation starts, inside the project it belongs to.
 *
 * The shell draws the navigation, so this file does not. `Header` was mounted
 * here to cover the sessions the shell leaves chromeless; dropping it is the
 * migration's deliberate trade (navigation is the shell's job, not this
 * page's), not a claim that the two components are equivalent.
 *
 * The parameters, their defaults and their validation belong to
 * `SimulationForm`, which this route only mounts and feeds: this file decides
 * which project the run joins and where a successful create lands. The column
 * stays at the 672px measure the migrated FRAKTAL creation screens use, so the
 * form's two-column rows do not stretch to ~650px per cell on the shell's
 * 1440px.
 */
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
    return <LoadingScreen message="Loading..." />
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Breadcrumb */}
      <Link
        href={`/projects/${id}`}
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {project?.name || 'Project'}
      </Link>

      <PageHeader
        eyebrow="SIMULATION"
        title="New Simulation"
        description="Configure and run a 3D agglomerate simulation"
      />

      <SimulationForm
        onSubmit={handleSubmit}
        isLoading={createSimulation.isPending}
      />
    </div>
  )
}
