'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useProject } from '@/hooks/useProjects'
import { studiesApi } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { BatchSimulationForm, BatchResultsTable } from '@/components/batch'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import type { CreateParametricStudyInput, ParametricStudyResults } from '@/lib/types'

export default function BatchSimulationsPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const queryClient = useQueryClient()
  const { data: project } = useProject(id)
  const [showForm, setShowForm] = useState(false)
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Fetch studies list (polls while any study has running simulations)
  const { data: studiesData, isLoading: isLoadingStudies } = useQuery({
    queryKey: ['studies', id],
    queryFn: () => studiesApi.list(id),
    refetchInterval: (query) => {
      const data = query.state.data
      // Poll if any study has running simulations (completed < total)
      const hasRunning = data?.results?.some(
        (s) => s.completed_simulations < s.total_simulations
      )
      return hasRunning ? 3000 : false
    },
  })

  // Fetch selected study results
  const { data: studyResults, refetch: refetchResults } = useQuery({
    queryKey: ['study-results', id, selectedStudyId],
    queryFn: () => studiesApi.getResults(id, selectedStudyId!),
    enabled: !!selectedStudyId,
    refetchInterval: (query) => {
      const data = query.state.data as ParametricStudyResults | undefined
      if (data && data.progress.running > 0) {
        return 3000 // Poll every 3 seconds while running
      }
      return false
    },
  })

  // Create study mutation
  const createStudy = useMutation({
    mutationFn: (data: CreateParametricStudyInput) => studiesApi.create(id, data),
    onSuccess: (newStudy) => {
      queryClient.invalidateQueries({ queryKey: ['studies', id] })
      setShowForm(false)
      setSelectedStudyId(newStudy.id)
    },
  })

  // Delete study mutation
  const deleteStudy = useMutation({
    mutationFn: (studyId: string) => studiesApi.delete(id, studyId),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['studies', id] })
      if (selectedStudyId === deletedId) {
        setSelectedStudyId(null)
      }
      setDeleteConfirm(null)
    },
  })

  const handleExport = async () => {
    if (!selectedStudyId) return
    setIsExporting(true)
    try {
      const blob = await studiesApi.exportCsv(id, selectedStudyId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${selectedStudyId}_results.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export:', err)
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoadingStudies) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <LoadingScreen message="Loading batch studies..." />
      </div>
    )
  }

  const studies = studiesData?.results || []

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Batch Simulations</h1>
            <p className="text-muted-foreground mt-1">
              Run parameter sweeps and compare results
            </p>
          </div>
          {!showForm && (
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Batch Study
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Form or Study List */}
          <div className="lg:col-span-1 space-y-4">
            {showForm ? (
              <div className="space-y-4">
                <BatchSimulationForm
                  onSubmit={(data) => createStudy.mutate(data)}
                  isLoading={createStudy.isPending}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-medium mb-3">Previous Studies</h3>
                  {studies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No batch studies yet. Create one to get started.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {studies.map((study) => (
                        <div
                          key={study.id}
                          className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
                            selectedStudyId === study.id
                              ? 'bg-primary/10 border-primary'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <button
                            onClick={() => setSelectedStudyId(study.id)}
                            className="flex-1 text-left"
                          >
                            <p className="font-medium truncate">{study.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {study.completed_simulations}/{study.total_simulations} completed
                            </p>
                          </button>
                          {deleteConfirm === study.id ? (
                            <div className="flex gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteStudy.mutate(study.id)}
                                disabled={deleteStudy.isPending}
                              >
                                {deleteStudy.isPending ? '...' : 'Yes'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDeleteConfirm(null)}
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(study.id)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-2">
            {selectedStudyId && studyResults ? (
              <BatchResultsTable
                data={studyResults}
                projectId={id}
                onExport={handleExport}
                onRefresh={() => refetchResults()}
                isExporting={isExporting}
              />
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">
                    {studies.length > 0
                      ? 'Select a study to view results'
                      : 'Create a batch study to run parameter sweeps'}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
