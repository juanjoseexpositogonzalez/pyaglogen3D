'use client'

import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import { useSimulation, useSimulationGeometry } from '@/hooks/useSimulations'
import { Header } from '@/components/layout/Header'
import { AgglomerateViewer } from '@/components/viewer3d/AgglomerateViewer'
import { ViewerControls } from '@/components/viewer3d/ViewerControls'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MetricsCard, MetricsGrid } from '@/components/common/MetricsCard'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Clock, Hash, Settings } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

export default function SimulationDetailPage({
  params,
}: {
  params: { id: string; simId: string }
}) {
  const { id, simId } = params
  const { data: project } = useProject(id)
  const { data: simulation, isLoading, error } = useSimulation(id, simId)
  const { data: geometry } = useSimulationGeometry(
    simId,
    simulation?.status === 'completed'
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <LoadingScreen message="Loading simulation..." />
      </div>
    )
  }

  if (error || !simulation) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <Card className="border-destructive">
            <CardContent className="p-6">
              <p className="text-destructive">
                Failed to load simulation. It may not exist or the backend is unavailable.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const coordinates = geometry?.coordinates ?? []
  const radii = geometry?.radii ?? []

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

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">
                {simulation.algorithm.toUpperCase()} Simulation
              </h1>
              <StatusBadge status={simulation.status} />
            </div>
            <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Hash className="h-4 w-4" />
                {'n_particles' in simulation.parameters &&
                  `${(simulation.parameters as { n_particles: number }).n_particles.toLocaleString()} particles`}
              </span>
              {simulation.execution_time_ms && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {(simulation.execution_time_ms / 1000).toFixed(2)}s
                </span>
              )}
              <span className="flex items-center gap-1">
                <Settings className="h-4 w-4" />
                Seed: {simulation.seed}
              </span>
            </div>
          </div>
        </div>

        {/* Running State */}
        {(simulation.status === 'queued' || simulation.status === 'running') && (
          <Card className="mb-8">
            <CardContent className="p-8 text-center">
              <div className="animate-pulse">
                <div className="h-8 w-8 mx-auto mb-4 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {simulation.status === 'queued' ? 'Simulation Queued' : 'Simulation Running'}
              </h3>
              <p className="text-muted-foreground">
                {simulation.status === 'queued'
                  ? 'Your simulation is in the queue and will start shortly...'
                  : 'Generating agglomerate structure... This page will update automatically.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Failed State */}
        {simulation.status === 'failed' && (
          <Card className="mb-8 border-destructive">
            <CardContent className="p-6">
              <h3 className="text-lg font-medium text-destructive mb-2">
                Simulation Failed
              </h3>
              <p className="text-muted-foreground">
                {simulation.error_message || 'An unknown error occurred during simulation.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Completed State */}
        {simulation.status === 'completed' && simulation.metrics && (
          <>
            {/* Metrics */}
            <MetricsGrid className="mb-8">
              <MetricsCard
                label="Fractal Dimension"
                value={formatNumber(simulation.metrics.fractal_dimension, 3)}
                subvalue={`+/- ${formatNumber(simulation.metrics.fractal_dimension_std, 3)}`}
              />
              <MetricsCard
                label="Prefactor (kf)"
                value={formatNumber(simulation.metrics.prefactor, 3)}
              />
              <MetricsCard
                label="Radius of Gyration"
                value={formatNumber(simulation.metrics.radius_of_gyration, 1)}
              />
              <MetricsCard
                label="Porosity"
                value={`${(simulation.metrics.porosity * 100).toFixed(1)}%`}
              />
            </MetricsGrid>

            {/* Coordination */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-lg">Coordination Number</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-8">
                  <div>
                    <p className="text-sm text-muted-foreground">Mean</p>
                    <p className="text-2xl font-bold">
                      {formatNumber(simulation.metrics.coordination.mean, 2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Std. Dev.</p>
                    <p className="text-2xl font-bold">
                      {formatNumber(simulation.metrics.coordination.std, 2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 3D Viewer */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
              <div className="lg:col-span-3">
                <Card>
                  <CardHeader>
                    <CardTitle>3D Visualization</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2">
                    <AgglomerateViewer
                      coordinates={coordinates}
                      radii={radii}
                      className="h-[600px]"
                    />
                  </CardContent>
                </Card>
              </div>
              <div className="lg:col-span-1">
                <ViewerControls />
              </div>
            </div>

            {/* Parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Simulation Parameters</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(simulation.parameters).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-sm text-muted-foreground">
                        {key.replace(/_/g, ' ')}
                      </dt>
                      <dd className="font-mono">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
