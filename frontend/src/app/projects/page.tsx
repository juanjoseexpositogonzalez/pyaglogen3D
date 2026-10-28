'use client'

import Link from 'next/link'
import { FolderOpen, Plus, Trash2, Atom, ImageIcon } from 'lucide-react'

import { useProjects, useDeleteProject } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { formatDistanceToNow } from '@/lib/utils'

/**
 * The projects list, on the design-system kit (wave 2, issue #172).
 *
 * Deliberately still a card grid. `Project` carries no status field and this
 * screen has no table, so `DataTable` and `StatusChip` have nothing to show
 * here; they belong to the project detail, where simulations do have a state.
 *
 * The delete control keeps its current behaviour, defects included: it is
 * invisible-but-focusable, nested inside the card link and guarded by a
 * native confirm(). Those are tracked in #178 and fixing them here would
 * hide a behaviour change inside a presentation port.
 */
export default function ProjectsPage() {
  const { data, isLoading, error } = useProjects()
  const deleteProject = useDeleteProject()

  const projects = data?.results ?? []

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (confirm('Are you sure you want to delete this project?')) {
      deleteProject.mutate(id)
    }
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Manage your simulation projects"
        actions={
          <Link href="/projects/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        }
      />

      {isLoading ? (
        <LoadingScreen message="Loading projects..." />
      ) : error ? (
        <Callout tone="danger" title="Failed to load projects">
          The request did not come back. Make sure the backend is running — this is not an
          empty list, so nothing has been lost.
        </Callout>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create your first project to start running simulations"
          action={
            <Link href="/projects/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Project
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="group block">
              <article className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent/50">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">
                    {project.name}
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-2 -mt-1 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => handleDelete(project.id, e)}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>

                {project.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-muted">
                    {project.description}
                  </p>
                )}

                {/* Pushed to the bottom so the metrics line up across the row
                    whatever the description does. A project without one is a
                    legitimate case, not missing data. */}
                <div className="mt-auto pt-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <Atom className="h-4 w-4" aria-hidden="true" />
                      <Num value={project.simulation_count} digits={0} size="sm" />
                      simulations
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                      <Num value={project.analysis_count} digits={0} size="sm" />
                      analyses
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    Updated {formatDistanceToNow(project.updated_at)}
                  </p>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
