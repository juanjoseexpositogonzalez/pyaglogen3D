'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProjects } from '@/hooks/useProjects'
import { useAuth } from '@/contexts/AuthContext'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { FolderOpen, Plus, Atom, ImageIcon } from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data, isLoading, error } = useProjects()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [authLoading, isAuthenticated, router])

  if (authLoading) {
    return <LoadingScreen message="Checking authentication..." />
  }

  // Don't render dashboard content if not authenticated
  if (!isAuthenticated) {
    return <LoadingScreen message="Redirecting to login..." />
  }

  const projects = data?.results ?? []
  const totalSimulations = projects.reduce((acc, p) => acc + p.simulation_count, 0)
  const totalAnalyses = projects.reduce((acc, p) => acc + p.analysis_count, 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your simulation projects"
        actions={
          <Link href="/projects/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </Link>
        }
      />

      {isLoading && <LoadingScreen message="Loading projects..." />}

      {!isLoading && error && (
        <Callout tone="danger" title="Projects could not be loaded">
          The backend did not answer. Check that it is running and try again.
        </Callout>
      )}

      {!isLoading && !error && (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <MetricCard kind="exact" label="Total Projects" value={projects.length} tone="teal" />
            <MetricCard
              kind="exact"
              label="Total Simulations"
              value={totalSimulations}
              tone="violet"
            />
            <MetricCard kind="exact" label="Total Analyses" value={totalAnalyses} tone="gold" />
          </div>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Recent Projects</h2>

            {projects.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="No projects yet"
                description="Create your first project to start running simulations"
                action={
                  <Link href="/projects/new">
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Project
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {projects.slice(0, 6).map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`} className="group">
                    <Panel
                      title={project.name}
                      hint={project.description || undefined}
                      className="h-full transition-colors group-hover:border-brand"
                    >
                      {/* Counts sit beside their icon and their word, never
                          fused into one string: the figure has to stay
                          comparable down a column of cards. */}
                      <div className="flex gap-4 text-ink-muted">
                        <span className="flex items-center gap-1.5">
                          <Atom className="h-4 w-4" aria-hidden="true" />
                          <Num value={project.simulation_count} digits={0} size="sm" />
                          <span className="text-[11px]">simulations</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                          <Num value={project.analysis_count} digits={0} size="sm" />
                          <span className="text-[11px]">analyses</span>
                        </span>
                      </div>
                    </Panel>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
