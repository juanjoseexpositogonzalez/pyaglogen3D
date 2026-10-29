'use client'

import { useCallback, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import JSZip from 'jszip'
import { Upload, FileArchive, Sparkles } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import {
  fraktalApi,
  ApiError,
  type FraktalBatchAlgorithm,
  type FraktalBatchProgress,
  type FraktalBatchRequest,
  type FraktalBatchResult,
} from '@/lib/api'

interface SimulationRef {
  id: string
  parameters: { dpo_nm: number }
}

interface FraktalBatchUploadProps {
  onSuccess: (result: FraktalBatchResult) => void
  onError?: (error: string) => void
  /** Project ID for the project-scoped batch endpoint. */
  projectId?: string
  /** Batch origin: "simulation" pre-fills dpo from sim; "external" (default) keeps current behavior. */
  origin?: 'simulation' | 'external'
  /** Simulation reference — required when origin="simulation". */
  simulation?: SimulationRef
}

interface DetectedMetadata {
  pixels_per_100nm?: number
  mode?: string
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB (backend hard limit)

const algorithmOptions: { value: FraktalBatchAlgorithm; label: string }[] = [
  { value: 'granulated_2012', label: 'Granulated 2012 (Lapuerta)' },
  { value: 'voxel_2018', label: 'Voxel 2018' },
]

export function FraktalBatchUpload({
  onSuccess,
  onError,
  projectId,
  origin = 'external',
  simulation,
}: FraktalBatchUploadProps) {
  const isSimOrigin = origin === 'simulation' && simulation != null
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [metadataDetected, setMetadataDetected] =
    useState<DetectedMetadata | null>(null)

  const [manualScale, setManualScale] = useState<string>('')
  const [dpoHint, setDpoHint] = useState<string>(
    isSimOrigin ? String(simulation!.parameters.dpo_nm) : '25'
  )
  const [autocalibrateDpo, setAutocalibrateDpo] = useState(false)
  const [algorithm, setAlgorithm] =
    useState<FraktalBatchAlgorithm>('granulated_2012')
  const [manualSimId, setManualSimId] = useState<string>('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progress, setProgress] = useState<FraktalBatchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // When a file is selected, try to pre-parse metadata.json client-side so the
  // UI can show the "auto-calibrated" badge. Backend is still the source of
  // truth — any failure here is non-fatal.
  const handleFileSelect = useCallback(async (f: File | null) => {
    setFile(f)
    setMetadataDetected(null)
    setError(null)

    if (!f) return

    if (f.size > MAX_UPLOAD_BYTES) {
      setError('File too large (max 100 MB)')
      setFile(null)
      return
    }

    try {
      const zip = await JSZip.loadAsync(f)
      const metaEntry = zip.file('metadata.json')
      if (metaEntry) {
        const text = await metaEntry.async('text')
        const meta = JSON.parse(text) as {
          parameters?: { pixels_per_100nm?: number }
          mode?: string
        }
        const pixelsPer100nm = meta?.parameters?.pixels_per_100nm
        if (typeof pixelsPer100nm === 'number' && pixelsPer100nm > 0) {
          setMetadataDetected({
            pixels_per_100nm: pixelsPer100nm,
            mode: meta?.mode,
          })
        }
      }
    } catch (err) {
      // Not a fatal error — backend will validate the ZIP.
      console.warn('Metadata pre-parse failed:', err)
    }
  }, [])

  const handleSubmit = async () => {
    if (!file) return

    setIsSubmitting(true)
    setError(null)
    setProgress(null)

    const request: FraktalBatchRequest = {
      file,
      algorithm,
    }

    // Calibration precedence matches backend R1/R2:
    // manual pixels_per_100nm (explicit) wins over metadata.
    if (manualScale) {
      const scale = parseFloat(manualScale)
      if (!Number.isFinite(scale) || scale <= 0) {
        setError('Invalid pixels_per_100nm value')
        setIsSubmitting(false)
        return
      }
      request.pixels_per_100nm = scale
    }

    if (autocalibrateDpo) {
      request.autocalibrate_dpo = true
    } else {
      const dpo = parseFloat(dpoHint)
      if (!Number.isFinite(dpo) || dpo <= 0) {
        setError('dpo_hint must be positive')
        setIsSubmitting(false)
        return
      }
      request.dpo_hint = dpo
    }

    if (manualSimId.trim()) {
      request.sim_id = manualSimId.trim()
    }

    // Wire origin + sim_dpo_nm for backend autocalibrate-default contract (R-DELTA-E3)
    request.origin = origin
    if (isSimOrigin) {
      request.sim_dpo_nm = simulation!.parameters.dpo_nm
    }

    try {
      const result = await fraktalApi.analyzeBatch(request, {
        onProgress: setProgress,
        projectId,
      })
      // Invalidate dashboard queries so the batch list refreshes
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['fraktal-batches', projectId] })
        queryClient.invalidateQueries({ queryKey: ['fraktal', projectId] })
      }
      onSuccess(result)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unexpected error'
      setError(msg)
      onError?.(msg)
    } finally {
      setIsSubmitting(false)
      setProgress(null)
    }
  }

  const canSubmit =
    file !== null &&
    !isSubmitting &&
    (!!manualScale || !!metadataDetected?.pixels_per_100nm)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileArchive className="h-5 w-5" />
          Batch FRAKTAL Analysis
        </CardTitle>
        <CardDescription>
          Upload a ZIP of projection images. If the ZIP was exported from
          pyaglogen3D, calibration is automatic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="zip-upload">ZIP file</Label>
          <Input
            id="zip-upload"
            type="file"
            accept=".zip"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />
        </div>

        {isSimOrigin && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              Using known dpo = {simulation!.parameters.dpo_nm} nm from simulation. Override?
            </AlertDescription>
          </Alert>
        )}

        {metadataDetected?.pixels_per_100nm && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              <strong>Auto-calibrated from metadata:</strong>{' '}
              {metadataDetected.pixels_per_100nm.toFixed(1)} px/100nm
              {metadataDetected.mode && ` (${metadataDetected.mode} mode)`}
            </AlertDescription>
          </Alert>
        )}

        {!metadataDetected?.pixels_per_100nm && file && (
          <div className="space-y-2">
            <Label htmlFor="manual-scale">Pixels per 100 nm (manual)</Label>
            <Input
              id="manual-scale"
              type="number"
              min="1"
              step="0.1"
              placeholder="e.g. 500"
              value={manualScale}
              onChange={(e) => setManualScale(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Required for ZIPs without metadata.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="algorithm">Algorithm</Label>
          <Select
            id="algorithm"
            options={algorithmOptions}
            value={algorithm}
            onChange={(e) =>
              setAlgorithm(e.target.value as FraktalBatchAlgorithm)
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="autocalibrate"
            type="checkbox"
            checked={autocalibrateDpo}
            onChange={(e) => setAutocalibrateDpo(e.target.checked)}
          />
          <Label htmlFor="autocalibrate" className="font-normal">
            Auto-calibrate dpo from image 0
          </Label>
        </div>

        {!autocalibrateDpo && (
          <div className="space-y-2">
            <Label htmlFor="dpo-hint">dpo (nm)</Label>
            <Input
              id="dpo-hint"
              type="number"
              min="1"
              step="0.1"
              value={dpoHint}
              onChange={(e) => setDpoHint(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="manual-sim-id">
            Simulation ID (optional — overrides filename detection)
          </Label>
          <Input
            id="manual-sim-id"
            type="text"
            placeholder="UUID"
            value={manualSimId}
            onChange={(e) => setManualSimId(e.target.value)}
          />
        </div>

        {progress && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Stage: {progress.stage}</span>
              <span>
                {progress.current} / {progress.total}
              </span>
            </div>
            <Progress value={progress.progress * 100} />
          </div>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full"
        >
          <Upload className="h-4 w-4 mr-2" />
          {isSubmitting ? 'Analyzing...' : 'Analyze batch'}
        </Button>
      </CardContent>
    </Card>
  )
}
