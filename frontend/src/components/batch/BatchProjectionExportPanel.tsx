'use client'

import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download, Loader2, AlertTriangle } from 'lucide-react'
import { triggerBatchProjectionExport, pollProjectionsStatus } from '@/lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchProjectionExportPanelProps {
  projectId: string
  studyId: string
  simulations: Array<{ id: string; name: string; status: string }>
  onExportComplete?: (zipFilename: string) => void
}

type ProjectionMode = 'grid' | 'fibonacci' | 'legacy'
type JobState = 'idle' | 'queued' | 'running' | 'completed' | 'failed'

interface ProgressInfo {
  current: number
  total: number
  currentSimId?: string
}

// ---------------------------------------------------------------------------
// Helpers — pure functions for mode config → backend body shape
// ---------------------------------------------------------------------------

export function buildBatchExportConfig(
  mode: ProjectionMode,
  gridAzStep: number,
  gridElStep: number,
  fibN: number
): Record<string, number> {
  switch (mode) {
    case 'grid':
      return { az_step: gridAzStep, el_step: gridElStep }
    case 'fibonacci':
      return { n: fibN }
    case 'legacy':
      return { az_step: gridAzStep, el_step: gridElStep }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BatchProjectionExportPanel({
  projectId,
  studyId,
  simulations,
  onExportComplete,
}: BatchProjectionExportPanelProps) {
  // Selection state
  const [selectedSimIds, setSelectedSimIds] = useState<Set<string>>(new Set())

  // Mode + config state
  const [mode, setMode] = useState<ProjectionMode>('grid')
  const [gridAzStep, setGridAzStep] = useState(30)
  const [gridElStep, setGridElStep] = useState(30)
  const [fibN, setFibN] = useState(50)

  // Job state
  const [jobState, setJobState] = useState<JobState>('idle')
  const [progress, setProgress] = useState<ProgressInfo>({ current: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [partialFailure, setPartialFailure] = useState<{
    failed: number
    succeeded: number
  } | null>(null)

  // Derived
  const selectedCount = selectedSimIds.size
  const totalCount = simulations.length

  // Selection handlers
  const handleToggleSim = useCallback((simId: string) => {
    setSelectedSimIds((prev) => {
      const next = new Set(prev)
      if (next.has(simId)) {
        next.delete(simId)
      } else {
        next.add(simId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedSimIds(new Set(simulations.map((s) => s.id)))
  }, [simulations])

  const handleDeselectAll = useCallback(() => {
    setSelectedSimIds(new Set())
  }, [])

  // Submit handler
  const handleGenerateExport = useCallback(async () => {
    if (selectedCount === 0 || jobState !== 'idle') return

    setJobState('queued')
    setError(null)
    setPartialFailure(null)
    setProgress({ current: 0, total: selectedCount })

    try {
      const config = buildBatchExportConfig(mode, gridAzStep, gridElStep, fibN)
      const body = {
        simulation_ids: Array.from(selectedSimIds),
        mode,
        config,
      }

      const response = await triggerBatchProjectionExport(projectId, studyId, body)
      const jobId = response.job_id

      setJobState('running')

      // Poll until done
      const result = await pollProjectionsStatus(
        jobId,
        (p: number, current: number, total: number) => {
          setProgress({ current, total })
        }
      )

      // Handle partial failures
      if (result.failed_sims && result.failed_sims.length > 0) {
        const failedCount = result.failed_sims.length
        const succeededCount = result.successful_sims ?? (selectedCount - failedCount)
        setPartialFailure({ failed: failedCount, succeeded: succeededCount })
      }

      setJobState('completed')

      // Auto-download
      if (result.download_url) {
        const downloadUrl = result.download_url.startsWith('http')
          ? result.download_url
          : `${window.location.origin}${result.download_url}`
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = ''
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }

      onExportComplete?.(result.download_filename || 'projections.zip')
    } catch (err) {
      setJobState('failed')
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }, [selectedCount, jobState, mode, gridAzStep, gridElStep, fibN, selectedSimIds, projectId, studyId, onExportComplete])

  const canGenerate = selectedCount > 0 && jobState === 'idle'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Export Projections</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Simulation selection table */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Select all
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeselectAll}>
              Deselect all
            </Button>
            <span className="text-sm text-muted-foreground ml-auto">
              {selectedCount} of {totalCount} selected
            </span>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left font-medium">Simulation</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {simulations.map((sim) => (
                  <tr key={sim.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selectedSimIds.has(sim.id)}
                        onCheckedChange={() => handleToggleSim(sim.id)}
                        aria-label={`Select ${sim.name}`}
                      />
                    </td>
                    <td className="px-3 py-2">{sim.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{sim.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mode selector */}
        <div className="space-y-1">
          <Label htmlFor="batch-projection-mode" className="text-xs">
            Sampling mode
          </Label>
          <Select
            id="batch-projection-mode"
            aria-label="Sampling mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ProjectionMode)}
            options={[
              { value: 'grid', label: 'Grid (Az × El)' },
              { value: 'fibonacci', label: 'Fibonacci lattice (uniform)' },
              { value: 'legacy', label: 'Legacy (manual sweep)' },
            ]}
          />
        </div>

        {/* Mode-specific config */}
        {(mode === 'grid' || mode === 'legacy') && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="batch-az-step" className="text-xs">
                Az step (°)
              </Label>
              <Input
                id="batch-az-step"
                type="number"
                min={1}
                max={360}
                value={gridAzStep}
                onChange={(e) => setGridAzStep(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="batch-el-step" className="text-xs">
                El step (°)
              </Label>
              <Input
                id="batch-el-step"
                type="number"
                min={1}
                max={180}
                value={gridElStep}
                onChange={(e) => setGridElStep(Number(e.target.value))}
                className="h-8"
              />
            </div>
          </div>
        )}

        {mode === 'fibonacci' && (
          <div className="space-y-1">
            <Label htmlFor="batch-fib-n" className="text-xs">
              Number of directions (n)
            </Label>
            <Input
              id="batch-fib-n"
              type="number"
              min={1}
              max={1000}
              value={fibN}
              onChange={(e) => setFibN(Number(e.target.value))}
              className="h-8"
            />
          </div>
        )}

        {/* Progress section */}
        {(jobState === 'queued' || jobState === 'running') && (
          <div className="space-y-2" data-testid="batch-export-progress">
            <Progress value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0} />
            <p className="text-sm text-muted-foreground">
              Processing simulation {progress.current} of {progress.total}
            </p>
          </div>
        )}

        {/* Partial failure warning */}
        {partialFailure && (
          <Alert variant="default">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {partialFailure.failed} sim{partialFailure.failed !== 1 ? 's' : ''} failed, {partialFailure.succeeded} succeeded. Download includes successful sims + manifest.
            </AlertDescription>
          </Alert>
        )}

        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Generate button */}
        <Button
          onClick={handleGenerateExport}
          disabled={!canGenerate}
          className="w-full"
        >
          {jobState === 'queued' || jobState === 'running' ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Generate & Export
        </Button>
      </CardContent>
    </Card>
  )
}
