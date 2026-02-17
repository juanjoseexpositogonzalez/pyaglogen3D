'use client'

import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useSimulations } from '@/hooks/useSimulations'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/common/StatusBadge'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { ArrowLeft, Plus, Atom, ImageIcon } from 'lucide-react'
import { formatDistanceToNow, formatNumber } from '@/lib/utils'

export default function ProjectDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id)
  const { data: simulations, isLoading: simulationsLoading } = useSimulations(id)

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <LoadingScreen message="Loading project..." />
      </div>
    )
  }

  if (projectError || !project) {
    return (
      <div className="min-h-screen bg-background">
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

  const simulationList = simulations?.results ?? []

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <Link
          href="/projects"
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Projects
        </Link>

        {/* Project Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground mt-2 max-w-2xl">
                {project.description}
              </p>
            )}
            <div className="flex gap-4 mt-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Atom className="h-4 w-4" />
                {project.simulation_count} simulations
              </span>
              <span className="flex items-center gap-1">
                <ImageIcon className="h-4 w-4" />
                {project.analysis_count} analyses
              </span>
            </div>
          </div>
          <Link href={`/projects/${id}/simulations/new`}>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Simulation
            </Button>
          </Link>
        </div>

        {/* Simulations List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Simulations</h2>

          {simulationsLoading ? (
            <LoadingScreen message="Loading simulations..." />
          ) : simulationList.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Atom className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No simulations yet</h3>
                <p className="text-muted-foreground mb-4">
                  Run your first simulation to generate 3D agglomerate structures
                </p>
                <Link href={`/projects/${id}/simulations/new`}>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Run Simulation
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {simulationList.map((sim) => (
                <Link
                  key={sim.id}
                  href={`/projects/${id}/simulations/${sim.id}`}
                >
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {sim.algorithm.toUpperCase()}
                              </span>
                              <StatusBadge status={sim.status} />
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {'n_particles' in sim.parameters &&
                                `${(sim.parameters as { n_particles: number }).n_particles.toLocaleString()} particles`}
                              {' • '}
                              {formatDistanceToNow(sim.created_at)}
                            </p>
                          </div>
                        </div>

                        {sim.status === 'completed' && sim.metrics && (
                          <div className="text-right">
                            <p className="text-sm">
                              <span className="text-muted-foreground">Df = </span>
                              <span className="font-mono font-medium">
                                {formatNumber(sim.metrics.fractal_dimension, 3)}
                              </span>
                            </p>
                            <p className="text-sm">
                              <span className="text-muted-foreground">Rg = </span>
                              <span className="font-mono">
                                {formatNumber(sim.metrics.radius_of_gyration, 1)}
                              </span>
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
