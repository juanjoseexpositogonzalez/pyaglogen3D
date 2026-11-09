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
 * The shell draws the navigation, so this file does not. What that costs is
 * worth stating plainly, because the sibling FRAKTAL page documents it and the
 * reasoning is easy to lose: `Header` was mounted here to cover the sessions
 * the shell leaves chromeless. `showChrome` is `!chromeless && isAuthenticated
 * && !isLoading`, while the middleware only checks that a session cookie
 * exists — so a stale cookie with a rejected token painted this route with no
 * rail, no top bar and no account link, and `Header` was the only way back to
 * a sign-in form. What this page gives up is that fallback chrome, and with it
 * the access link. It is not a claim that the two components are equivalent,
 * and the navigation is not unchanged.
 *
 * The parameters, their defaults and their validation belong to
 * `SimulationForm`, which this route only mounts and feeds: this file decides
 * which project the run joins and where a successful create lands. The column
 * stays at the 672px measure the migrated FRAKTAL creation screens use, so the
 * form's two-column rows do not stretch to ~650px per cell on the shell's
 * 1440px. The cap is `mx-auto w-full`, not the legacy `container px-4 py-8`:
 * the shell already owns the page gutter, and both together pad twice.
 *
 * One thing the FRAKTAL sibling has and this page does not is an error branch.
 * A failed `useProject` leaves `isLoading` false and `data` undefined, so the
 * page falls through to the happy path and paints a working form — submit
 * included — for a project that may not exist; the create then ends in the
 * `catch` below, which only writes to the console. The sibling answers both
 * with a `Callout` and a way back. Adding one here would change what a user
 * sees on a failed request, so it belongs to its own issue, not to this port.
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
