'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Progress } from '@/components/ui/progress'
import { Download, Image, Loader2, Camera } from 'lucide-react'
import { useViewerStore } from '@/stores/viewerStore'
import type { ExportProjectionsPayload } from '@/lib/api'

export interface ProjectionParams {
  azimuth: number
  elevation: number
  format: 'png' | 'svg'
}

/**
 * Legacy batch sweep parameters — preserved unchanged for backcompat (R3).
 * The new mode-aware payload is {@link ExportProjectionsPayload}.
 */
export interface BatchParams {
  azimuth_start: number
  azimuth_end: number
  azimuth_step: number
  elevation_start: number
  elevation_end: number
  elevation_step: number
  format: 'png' | 'svg'
}

export type ProjectionMode = 'grid' | 'fibonacci' | 'legacy'

export interface ExportProgress {
  progress: number // 0..1
  current: number
  total: number
}

interface ProjectionControlsProps {
  onPreview: (params: ProjectionParams) => void
  /** Legacy batch download (kept for backward compat with existing callers). */
  onDownloadBatch?: (params: BatchParams) => void
  /**
   * New mode-aware export. Prefer this over ``onDownloadBatch``; the
   * component will call it for all three modes (grid / fibonacci / legacy).
   * If omitted, the Legacy tab falls back to ``onDownloadBatch``.
   */
  onExport?: (
    payload: ExportProjectionsPayload,
    onProgress?: (p: ExportProgress) => void
  ) => void | Promise<void>
  isLoading?: boolean
  isBatchLoading?: boolean
}

/**
 * Preview-count formulas per the contract (spec R1 / R2):
 * - Grid: `n_az * (n_el - 2) + 2` — `n_el` includes BOTH poles, dedup'd.
 * - Fibonacci: exactly `n` uniform projections on a golden-angle lattice.
 * - Legacy: `floor((end-start)/step)+1` per axis, multiplied.
 *
 * Exported so tests can assert directly against the same formula the UI
 * renders — no drift between "what we show" and "what we compute".
 */
export function computeGridCount(n_az: number, n_el: number): number {
  if (!Number.isFinite(n_az) || !Number.isFinite(n_el)) return 0
  if (n_az < 1 || n_el < 2) return 0
  return n_az * (n_el - 2) + 2
}

export function ProjectionControls({
  onPreview,
  onDownloadBatch,
  onExport,
  isLoading,
  isBatchLoading,
}: ProjectionControlsProps) {
  const { cameraAzimuth, cameraElevation } = useViewerStore()
  const [azimuth, setAzimuth] = useState(45)
  const [elevation, setElevation] = useState(30)
  const [format, setFormat] = useState<'png' | 'svg'>('png')

  // Mode selector — grid is the new default (R1).
  const [mode, setMode] = useState<ProjectionMode>('grid')

  // Grid inputs
  const [nAz, setNAz] = useState(10)
  const [nEl, setNEl] = useState(5)

  // Fibonacci input
  const [nFib, setNFib] = useState(50)

  // Shared
  const [imgSize, setImgSize] = useState(512)

  // Legacy inputs (unchanged from prior version)
  const [azStart, setAzStart] = useState(0)
  const [azEnd, setAzEnd] = useState(150)
  const [azStep, setAzStep] = useState(30)
  const [elStart, setElStart] = useState(0)
  const [elEnd, setElEnd] = useState(90)
  const [elStep, setElStep] = useState(30)

  // Async progress state (only set when the backend dispatches to Celery)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleProjectCurrentView = () => {
    setAzimuth(cameraAzimuth)
    setElevation(cameraElevation)
    onPreview({ azimuth: cameraAzimuth, elevation: cameraElevation, format })
  }

  const handlePreview = () => {
    onPreview({ azimuth, elevation, format })
  }

  // Legacy count formula — preserved verbatim from prior version.
  const legacyAzSteps =
    azStep > 0 ? Math.floor((azEnd - azStart) / azStep) + 1 : 0
  const legacyElSteps =
    elStep > 0 ? Math.floor((elEnd - elStart) / elStep) + 1 : 0
  const legacyTotal = Math.max(0, legacyAzSteps * legacyElSteps)

  const gridInvalid = nEl < 2 || nAz < 1
  const gridCount = computeGridCount(nAz, nEl)

  const fibInvalid = nFib < 1 || nFib > 10000

  const totalProjections =
    mode === 'grid'
      ? gridCount
      : mode === 'fibonacci'
        ? nFib
        : legacyTotal

  const canSubmit =
    !isSubmitting &&
    !isBatchLoading &&
    (mode === 'grid'
      ? !gridInvalid
      : mode === 'fibonacci'
        ? !fibInvalid
        : legacyTotal > 0)

  const handleExport = async () => {
    setProgress(null)
    setIsSubmitting(true)
    try {
      if (mode === 'grid') {
        const payload: ExportProjectionsPayload = {
          mode: 'grid',
          n_az: nAz,
          n_el: nEl,
          img_size: imgSize,
          format,
        }
        if (onExport) {
          await onExport(payload, setProgress)
        }
      } else if (mode === 'fibonacci') {
        const payload: ExportProjectionsPayload = {
          mode: 'fibonacci',
          n: nFib,
          img_size: imgSize,
          format,
        }
        if (onExport) {
          await onExport(payload, setProgress)
        }
      } else {
        // Legacy — prefer onExport with mode=legacy when available, else
        // fall back to the classic onDownloadBatch callback so existing
        // consumers keep working.
        const legacyPayload: ExportProjectionsPayload = {
          mode: 'legacy',
          azimuth_start: azStart,
          azimuth_end: azEnd,
          azimuth_step: azStep,
          elevation_start: elStart,
          elevation_end: elEnd,
          elevation_step: elStep,
          format,
        }
        if (onExport) {
          await onExport(legacyPayload, setProgress)
        } else if (onDownloadBatch) {
          onDownloadBatch({
            azimuth_start: azStart,
            azimuth_end: azEnd,
            azimuth_step: azStep,
            elevation_start: elStart,
            elevation_end: elEnd,
            elevation_step: elStep,
            format,
          })
        }
      }
    } finally {
      setIsSubmitting(false)
      // Keep the progress bar visible on completion for a beat so the user
      // sees 100%; parent re-render or next submit resets it.
    }
  }

  const submitDisabled = !canSubmit

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">2D Projection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Preview Controls (unchanged) */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm">Preview Single Projection</h4>

          <div className="space-y-2">
            <Label>Azimuth: {azimuth}°</Label>
            <Slider
              min={0}
              max={360}
              step={5}
              value={[azimuth]}
              onValueChange={([v]) => setAzimuth(v)}
            />
          </div>

          <div className="space-y-2">
            <Label>Elevation: {elevation}°</Label>
            <Slider
              min={-90}
              max={90}
              step={5}
              value={[elevation]}
              onValueChange={([v]) => setElevation(v)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant={format === 'png' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFormat('png')}
            >
              PNG
            </Button>
            <Button
              variant={format === 'svg' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFormat('svg')}
            >
              SVG
            </Button>
          </div>

          <div className="flex gap-2">
            <Button onClick={handlePreview} disabled={isLoading} className="flex-1">
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Image className="h-4 w-4 mr-2" />
              )}
              Preview
            </Button>
            <Button
              onClick={handleProjectCurrentView}
              disabled={isLoading}
              variant="outline"
              className="flex-1"
              title={`Project current 3D view (Az: ${cameraAzimuth}°, El: ${cameraElevation}°)`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Camera className="h-4 w-4 mr-2" />
              )}
              3D View
            </Button>
          </div>
        </div>

        <hr className="border-border" />

        {/* Batch / Export Controls */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm">Batch Download</h4>

          {/* Mode selector */}
          <div className="space-y-1">
            <Label htmlFor="projection-mode" className="text-xs">
              Sampling mode
            </Label>
            <Select
              id="projection-mode"
              aria-label="Sampling mode"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as ProjectionMode)
                setProgress(null)
              }}
              options={[
                { value: 'grid', label: 'Grid (Az × El)' },
                { value: 'fibonacci', label: 'Fibonacci lattice (uniform)' },
                { value: 'legacy', label: 'Legacy (manual sweep)' },
              ]}
            />
          </div>

          {/* Grid inputs */}
          {mode === 'grid' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="grid-n-az" className="text-xs">
                    Azimuth samples (n_az)
                  </Label>
                  <Input
                    id="grid-n-az"
                    type="number"
                    min={1}
                    value={nAz}
                    onChange={(e) => setNAz(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="grid-n-el" className="text-xs">
                    Elevation samples (n_el)
                  </Label>
                  <Input
                    id="grid-n-el"
                    type="number"
                    min={2}
                    value={nEl}
                    onChange={(e) => setNEl(Number(e.target.value))}
                    className="h-8"
                    aria-invalid={nEl < 2}
                  />
                </div>
              </div>
              {nEl < 2 && (
                <p
                  className="text-xs text-destructive"
                  data-testid="grid-n-el-error"
                >
                  n_el must be at least 2 (both poles required)
                </p>
              )}
            </div>
          )}

          {/* Fibonacci inputs */}
          {mode === 'fibonacci' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="fib-n" className="text-xs">
                  Number of directions (n)
                </Label>
                <Input
                  id="fib-n"
                  type="number"
                  min={1}
                  max={10000}
                  value={nFib}
                  onChange={(e) => setNFib(Number(e.target.value))}
                  className="h-8"
                  aria-invalid={fibInvalid}
                />
              </div>
              {fibInvalid && (
                <p
                  className="text-xs text-destructive"
                  data-testid="fib-n-error"
                >
                  n must be between 1 and 10000
                </p>
              )}
            </div>
          )}

          {/* Legacy inputs — preserved verbatim */}
          {mode === 'legacy' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Az Start</Label>
                  <Input
                    type="number"
                    value={azStart}
                    onChange={(e) => setAzStart(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Az End</Label>
                  <Input
                    type="number"
                    value={azEnd}
                    onChange={(e) => setAzEnd(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Az Step</Label>
                  <Input
                    type="number"
                    value={azStep}
                    onChange={(e) => setAzStep(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">El Start</Label>
                  <Input
                    type="number"
                    value={elStart}
                    onChange={(e) => setElStart(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">El End</Label>
                  <Input
                    type="number"
                    value={elEnd}
                    onChange={(e) => setElEnd(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">El Step</Label>
                  <Input
                    type="number"
                    value={elStep}
                    onChange={(e) => setElStep(Number(e.target.value))}
                    className="h-8"
                  />
                </div>
              </div>
            </>
          )}

          {/* Image size knob — relevant for grid + fibonacci */}
          {mode !== 'legacy' && (
            <div className="space-y-1">
              <Label htmlFor="img-size" className="text-xs">
                Image size (px)
              </Label>
              <Input
                id="img-size"
                type="number"
                min={64}
                max={4096}
                value={imgSize}
                onChange={(e) => setImgSize(Number(e.target.value))}
                className="h-8"
              />
            </div>
          )}

          {/* Preview count */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="projection-count-preview"
          >
            {mode === 'grid' && `Will generate ${gridCount} projections`}
            {mode === 'fibonacci' && `Will generate ${nFib} uniform projections`}
            {mode === 'legacy' &&
              `${totalProjections} projections will be generated`}
          </p>

          {/* Async progress bar */}
          {progress && (
            <div className="space-y-1" data-testid="export-progress">
              <Progress value={Math.round(progress.progress * 100)} />
              <p className="text-xs text-muted-foreground">
                {progress.current} / {progress.total} rendered (
                {Math.round(progress.progress * 100)}%)
              </p>
            </div>
          )}

          <Button
            onClick={handleExport}
            disabled={submitDisabled}
            variant="outline"
            className="w-full"
          >
            {isSubmitting || isBatchLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download ZIP
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
