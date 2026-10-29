'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProject } from '@/hooks/useProjects'
import { useSimulations } from '@/hooks/useSimulations'
import { useFraktalAnalyses, useDeleteFraktalAnalysis } from '@/hooks/useFraktalAnalyses'
import { useFraktalBatches } from '@/hooks/useFraktalBatches'
import { FraktalBatchesSection } from '@/components/fraktal/FraktalBatchesSection'
import { simulationsApi, fraktalApi } from '@/lib/api'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { StatusChip } from '@/components/kit/StatusChip'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusBadge } from '@/components/common/StatusBadge'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { ArrowLeft, Plus, Atom, StopCircle, Trash2, Microscope, Layers, Upload, GitCompare } from 'lucide-react'
import { formatDistanceToNow, formatNumber } from '@/lib/utils'
import { getScaleFactorNm, getSchemaVersion } from '@/lib/units'
import { MAX_COMPARE_SIMS } from '@/lib/compare-utils'
import { UnitConventionBanner } from '@/components/banners/UnitConventionBanner'
import { useAuth } from '@/contexts/AuthContext'
import { ImportAggregateDialog } from '@/components/forms/ImportAggregateDialog'

export default function ProjectDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const { user } = useAuth()
  const router = useRouter()
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id)
  const { data: simulations, isLoading: simulationsLoading, error: simulationsError, refetch } = useSimulations(id)
  const { data: fraktalAnalyses, isLoading: fraktalLoading, refetch: refetchFraktal } = useFraktalAnalyses(id)
  const { data: fraktalBatches, isLoading: batchesLoading } = useFraktalBatches(id)
  const deleteFraktal = useDeleteFraktalAnalysis(id)

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [fraktalDeleteConfirm, setFraktalDeleteConfirm] = useState<string | null>(null)
  const [deleteAllSimsConfirm, setDeleteAllSimsConfirm] = useState(false)
  const [deleteAllFraktalConfirm, setDeleteAllFraktalConfirm] = useState(false)
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // Compare selection — local state (URL is the source of truth on the
  // /compare page itself, this set just drives the checkboxes + nav button).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelection = (simId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(simId)) {
        next.delete(simId)
      } else if (next.size < MAX_COMPARE_SIMS) {
        next.add(simId)
      } else {
        // Cap: the 10th+ click is ignored. The disabled visual state on
        // unchecked boxes (see below) communicates why.
        return prev
      }
      return next
    })
  }

  const handleCompare = () => {
    if (selectedIds.size < 2) return
    const ids = Array.from(selectedIds).join(',')
    router.push(`/projects/${id}/compare?sims=${ids}`)
  }

  const handleCancel = async (simId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setActionLoading(simId)
    try {
      await simulationsApi.cancel(id, simId)
      refetch()
    } catch (err) {
      console.error('Failed to cancel simulation:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (simId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setActionLoading(simId)
    try {
      await simulationsApi.delete(id, simId)
      refetch()
    } catch (err) {
      console.error('Failed to delete simulation:', err)
    } finally {
      setActionLoading(null)
      setDeleteConfirm(null)
    }
  }

  const handleDeleteFraktal = async (analysisId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await deleteFraktal.mutateAsync(analysisId)
      refetchFraktal()
    } catch (err) {
      console.error('Failed to delete FRAKTAL analysis:', err)
    } finally {
      setFraktalDeleteConfirm(null)
    }
  }

  const handleDeleteAllSimulations = async () => {
    setBulkDeleteLoading(true)
    try {
      await simulationsApi.deleteAll(id)
      refetch()
    } catch (err) {
      console.error('Failed to delete all simulations:', err)
    } finally {
      setBulkDeleteLoading(false)
      setDeleteAllSimsConfirm(false)
    }
  }

  const handleDeleteAllFraktal = async () => {
    setBulkDeleteLoading(true)
    try {
      await fraktalApi.deleteAll(id)
      refetchFraktal()
    } catch (err) {
      console.error('Failed to delete all FRAKTAL analyses:', err)
    } finally {
      setBulkDeleteLoading(false)
      setDeleteAllFraktalConfirm(false)
    }
  }

  if (projectLoading) {
    return <LoadingScreen message="Loading project..." />
  }

  if (projectError || !project) {
    return (
      <>
        <PageHeader eyebrow="PROJECT" title="Project unavailable" />
        <Callout
          tone="danger"
          title="Failed to load project"
          action={
            <Link href="/projects">
              <Button variant="outline">Back to Projects</Button>
            </Link>
          }
        >
          It may not exist, or the backend is unavailable. This is not an empty project: nothing
          has been deleted by visiting this page.
        </Callout>
      </>
    )
  }

  const simulationList = simulations?.results ?? []

  // Show the unit-convention banner once at the top if ANY listed simulation
  // resolves to the legacy (v1/null) schema. A single top-of-page banner keeps
  // the list visually clean instead of rendering per-row.
  const hasLegacySim = simulationList.some(
    (s) =>
      getSchemaVersion(
        (s.parameters ?? {}) as unknown as Record<string, unknown>,
      ) !== 'v2',
  )

  return (
    <>
      {/* Unit convention banner — shown once if any legacy simulation is in the list */}
      {hasLegacySim && (
        <UnitConventionBanner
          simulationId={id}
          schemaVersion={'v1'}
          userId={user?.id ?? 'anonymous'}
        />
      )}

      <Link
        href="/projects"
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Projects
      </Link>

      <PageHeader
        eyebrow="PROJECT"
        title={project.name}
        description={project.description ?? undefined}
        actions={
          <>
            <Link href={`/projects/${id}/batch`}>
              <Button variant="outline">
                <Layers className="h-4 w-4 mr-2" />
                Batch Simulations
              </Button>
            </Link>
            <Link href={`/projects/${id}/fraktal/new`}>
              <Button variant="outline">
                <Microscope className="h-4 w-4 mr-2" />
                FRAKTAL Analysis
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Aggregate
            </Button>
            <Link href={`/projects/${id}/simulations/new`}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Simulation
              </Button>
            </Link>
          </>
        }
      />

      {/*
        Counts, not readings. `simulation_count` and `analysis_count` are
        exact by construction, so they demand no sigma and no estimator — the
        `exact` variant of MetricCard is the one that does not ask for them.

        The label is "Analyses", not "FRAKTAL analyses" as the reference
        design has it: `Project.analysis_count` adds ImageAnalysis *and*
        FraktalAnalysis, so the narrower word would promise less than the field
        returns. The detail line says what the number covers.
      */}
      <div className="mb-[18px] grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard
          kind="exact"
          tone="teal"
          label="Simulations"
          value={project.simulation_count}
          digits={0}
        />
        <MetricCard
          kind="exact"
          tone="violet"
          label="Analyses"
          value={project.analysis_count}
          digits={0}
          detail="Image and FRAKTAL"
        />
      </div>

        {/* Simulations List */}
        <Panel
          title="Simulations"
          hint="Every run in this project, with the readings it produced. Tick two or more to compare them."
          action={
            simulationList.length > 0 &&
            (deleteAllSimsConfirm ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-muted">
                  Delete all {simulationList.length} simulations?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteAllSimulations}
                  disabled={bulkDeleteLoading}
                >
                  {bulkDeleteLoading ? 'Deleting...' : 'Yes, Delete All'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteAllSimsConfirm(false)}
                  disabled={bulkDeleteLoading}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteAllSimsConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete All
              </Button>
            ))
          }
        >
          {simulationsLoading ? (
            <LoadingScreen message="Loading simulations..." />
          ) : simulationsError ? (
            <Callout tone="danger" title="Failed to load simulations">
              The request did not come back. This is not an empty project: the runs are still
              there, this page could not read them.
            </Callout>
          ) : simulationList.length === 0 ? (
            <EmptyState
              icon={Atom}
              headingLevel={3}
              title="No simulations yet"
              description="Run your first simulation to generate 3D agglomerate structures"
              action={
                <Link href={`/projects/${id}/simulations/new`}>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Run Simulation
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-4">
              {simulationList.map((sim) => {
                const isSelected = selectedIds.has(sim.id)
                const capReached = !isSelected && selectedIds.size >= MAX_COMPARE_SIMS
                return (
                <Link
                  key={sim.id}
                  href={`/projects/${id}/simulations/${sim.id}`}
                  className="block"
                >
                  <article className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-brand">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          {/*
                            Compare selection checkbox — does NOT navigate (R1/S1.6).
                            Wrap in a stopPropagation-only span so the Link's default
                            navigation is blocked without `preventDefault`-ing the
                            native checkbox toggle. Previous impl put `preventDefault`
                            on the Checkbox's `onClick`, which cancelled the browser's
                            native toggle and caused the tick to appear one click late
                            (stale visual state fixed only by a sibling re-render).
                          */}
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                            }}
                          >
                            <Checkbox
                              aria-label={`Select ${sim.algorithm} simulation for comparison`}
                              checked={isSelected}
                              disabled={capReached}
                              title={capReached ? `Maximum ${MAX_COMPARE_SIMS} simulations at once` : undefined}
                              onCheckedChange={() => toggleSelection(sim.id)}
                            />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-semibold text-ink">
                                {/*
                                  Prefer the user-assigned / backend-generated `name`;
                                  fall back to the algorithm code only for legacy
                                  records that predate the name field.
                                */}
                                {sim.name?.trim() || sim.algorithm.toUpperCase()}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {sim.algorithm.toUpperCase()}
                              </Badge>
                              <StatusChip status={sim.status} />
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                              {'n_particles' in sim.parameters && (
                                <span className="inline-flex items-baseline gap-1">
                                  <Num
                                    value={(sim.parameters as { n_particles: number }).n_particles}
                                    digits={0}
                                    size="sm"
                                  />
                                  <span>particles</span>
                                </span>
                              )}
                              <span>{formatDistanceToNow(sim.created_at)}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          {sim.status === 'completed' && sim.metrics && (() => {
                            const scale = getScaleFactorNm(
                              (sim.parameters ?? {}) as unknown as Record<string, unknown>,
                            )
                            return (
                              <div className="text-right text-[11px] leading-relaxed">
                                <p className="m-0 flex items-baseline justify-end gap-1.5">
                                  <span className="text-ink-muted">Df</span>
                                  <Num value={sim.metrics.fractal_dimension} digits={3} size="sm" />
                                </p>
                                <p className="m-0 flex items-baseline justify-end gap-1.5">
                                  <span className="text-ink-muted">Rg</span>
                                  <Num
                                    value={sim.metrics.radius_of_gyration * scale}
                                    digits={1}
                                    unit="nm"
                                    size="sm"
                                  />
                                </p>
                              </div>
                            )
                          })()}

                          {/* Action Buttons */}
                          <div className="flex gap-2">
                            {(sim.status === 'queued' || sim.status === 'running') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => handleCancel(sim.id, e)}
                                disabled={actionLoading === sim.id}
                              >
                                <StopCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {deleteConfirm === sim.id ? (
                              <div className="flex gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={(e) => handleDelete(sim.id, e)}
                                  disabled={actionLoading === sim.id}
                                >
                                  {actionLoading === sim.id ? '...' : 'Yes'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setDeleteConfirm(null)
                                  }}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setDeleteConfirm(sim.id)
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                  </article>
                </Link>
                )
              })}
            </div>
          )}
        </Panel>

        {/* FRAKTAL Analyses List */}
        <div className="space-y-4 mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">FRAKTAL Analyses</h2>
            {(fraktalAnalyses?.results ?? []).length > 0 && (
              deleteAllFraktalConfirm ? (
                <div className="flex gap-2 items-center">
                  <span className="text-sm text-muted-foreground">
                    Delete all {fraktalAnalyses?.results?.length} analyses?
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteAllFraktal}
                    disabled={bulkDeleteLoading}
                  >
                    {bulkDeleteLoading ? 'Deleting...' : 'Yes, Delete All'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteAllFraktalConfirm(false)}
                    disabled={bulkDeleteLoading}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteAllFraktalConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete All
                </Button>
              )
            )}
          </div>

          {fraktalLoading ? (
            <LoadingScreen message="Loading analyses..." />
          ) : (fraktalAnalyses?.results ?? []).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Microscope className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No FRAKTAL analyses yet</h3>
                <p className="text-muted-foreground mb-4">
                  Analyze fractal properties of agglomerate images or simulation projections
                </p>
                <Link href={`/projects/${id}/fraktal/new`}>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Run FRAKTAL Analysis
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {(fraktalAnalyses?.results ?? []).map((analysis) => (
                <Link
                  key={analysis.id}
                  href={`/projects/${id}/fraktal/${analysis.id}`}
                >
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {analysis.model === 'granulated_2012' ? 'Granulated 2012' : 'Voxel 2018'}
                              </span>
                              <Badge variant="outline">
                                {analysis.source_type === 'uploaded_image' ? 'Image' : 'Projection'}
                              </Badge>
                              <StatusBadge status={analysis.status} />
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {formatDistanceToNow(analysis.created_at)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          {analysis.status === 'completed' && analysis.results && (
                            <div className="text-right">
                              <p className="text-sm">
                                <span className="text-muted-foreground">Df = </span>
                                <span className="font-mono font-medium">
                                  {formatNumber(analysis.results.df, 3)}
                                </span>
                              </p>
                              <p className="text-sm">
                                <span className="text-muted-foreground">Npo = </span>
                                <span className="font-mono">
                                  {analysis.results.npo?.toLocaleString() ?? 'N/A'}
                                </span>
                              </p>
                            </div>
                          )}

                          {/* Delete Button */}
                          <div className="flex gap-2">
                            {fraktalDeleteConfirm === analysis.id ? (
                              <div className="flex gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={(e) => handleDeleteFraktal(analysis.id, e)}
                                  disabled={deleteFraktal.isPending}
                                >
                                  {deleteFraktal.isPending ? '...' : 'Yes'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setFraktalDeleteConfirm(null)
                                  }}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setFraktalDeleteConfirm(analysis.id)
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* FRAKTAL Batches Section */}
        <FraktalBatchesSection
          projectId={id}
          batches={fraktalBatches?.results}
          isLoading={batchesLoading}
        />

      {/* Sticky Compare bar — only when ≥2 sims selected (R1/S1.3). */}
      {selectedIds.size >= 2 && (
        <div
          role="region"
          aria-label="Compare simulations"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-background p-3 shadow-lg"
        >
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <Button onClick={handleCompare} size="sm">
            <GitCompare className="h-4 w-4 mr-2" />
            Compare ({selectedIds.size})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <ImportAggregateDialog
        projectId={id}
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onSuccess={(simulationId) => {
          setImportDialogOpen(false)
          refetch()
          router.push(`/projects/${id}/simulations/${simulationId}`)
        }}
      />
    </>
  )
}
