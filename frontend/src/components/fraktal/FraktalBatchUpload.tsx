'use client'

/**
 * Batch FRAKTAL upload form, on the design-system kit (issue #176, slice 3 of
 * 3, part A).
 *
 * What it does is unchanged: the same file input, the same client-side
 * metadata pre-parse, the same two calibration paths, the same two validation
 * messages, the same request and the same `onSuccess` hand-off. What changed is
 * who owns the presentation — the card is a `Panel`, the two notices that used
 * to be `Alert`s are `Callout`s, the checkbox is the kit's `Checkbox`, and the
 * progress counts go through `Num`.
 *
 * Three presentation decisions are worth stating rather than leaving to be
 * found in review:
 *
 * 1. The two calibration notices keep their sentence as prose, not as `Num`.
 *    `Num` renders a value and its unit as sibling elements so the number
 *    carries the tabular styling and the unit does not pad it; that is right
 *    for a reading in a value position and wrong for a number inside a
 *    sentence. The sentence is also frozen by the contract ("same messages")
 *    and pinned verbatim by this file's tests, so the number stays a run of
 *    text inside the sentence. The progress counts are the opposite case: they
 *    are readings, and they do go through `Num`.
 * 2. A validation failure reads as `Callout tone="danger"` with the message
 *    itself as the title, verbatim. Inventing a headline such as "Upload
 *    failed" would add words the contract does not have and would put the
 *    message the user needs one line further down.
 * 3. The submit button keeps both of its labels ("Analyzing..." / "Analyze
 *    batch") and its `disabled` gate, which is `canSubmit`.
 */
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import JSZip from 'jszip'
import { Upload, FileArchive } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Callout } from '@/components/kit/Callout'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'
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
    <Panel
      title={
        <span className="flex items-center gap-2">
          <FileArchive className="h-5 w-5" aria-hidden="true" />
          Batch FRAKTAL Analysis
        </span>
      }
      hint="Upload a ZIP of projection images. If the ZIP was exported from pyaglogen3D, calibration is automatic."
      bodyClassName="space-y-4"
    >
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
        <Callout
          tone="info"
          title={`Using known dpo = ${simulation!.parameters.dpo_nm} nm from simulation. Override?`}
        />
      )}

      {metadataDetected?.pixels_per_100nm && (
        <Callout tone="info" title="Auto-calibrated from metadata">
          {metadataDetected.pixels_per_100nm.toFixed(1)} px/100nm
          {metadataDetected.mode && ` (${metadataDetected.mode} mode)`}
        </Callout>
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
          <p className="hint">Required for ZIPs without metadata.</p>
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
        <Checkbox
          id="autocalibrate"
          checked={autocalibrateDpo}
          onCheckedChange={setAutocalibrateDpo}
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
          <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
            <span>Stage: {progress.stage}</span>
            <span>
              <Num value={progress.current} digits={0} size="sm" />
              {' / '}
              <Num value={progress.total} digits={0} size="sm" />
            </span>
          </div>
          <Progress value={progress.progress * 100} />
        </div>
      )}

      {error && <Callout tone="danger" title={error} />}

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full"
      >
        <Upload className="h-4 w-4 mr-2" />
        {isSubmitting ? 'Analyzing...' : 'Analyze batch'}
      </Button>
    </Panel>
  )
}
