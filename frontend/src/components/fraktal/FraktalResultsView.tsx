'use client'

/**
 * One FRAKTAL analysis, on the design-system kit (issue #176, slice 2 of 3).
 *
 * What this file shows is the same: the same fields in the same order, the same
 * arithmetic for the change column, the same download, the same polling of the
 * comparison run. What changed is who owns the presentation — every surface is
 * a `Panel`, every reading goes through `Num` (value and unit as siblings,
 * never a concatenated string), the two tables are `DataTable` instances with
 * numeric headers right-aligned as the primitive prescribes, and every state
 * that used to be a coloured card is a `Callout` whose tone never carries the
 * meaning alone.
 *
 * Four presentation decisions came with it. Each is declared here rather than
 * left to be discovered in review:
 *
 * 1. Four readings lost their compact suffix: `ap`, `volume`, `surface_area`
 *    and `mass` used to be printed by a local `formatLargeNumber` (45.00K).
 *    `Num` groups thousands instead (45,000.00), which is exact rather than
 *    rounded, keeps the unit in its own element and is the same number the
 *    record holds. No value and no arithmetic changed with it.
 * 2. A ratio is printed at a fixed two decimals (`Ratio` below) instead of
 *    through `Num`'s formatter, which sends anything under 0.001 to
 *    `toExponential`: `8.0e-4 x` in the column that says how far the estimate
 *    missed reads as a different kind of number. The sweep's table and the
 *    mismatch notice now print the same precision; the notice used to print
 *    one decimal for the same quantity, so `3.4x` became `3.40x`.
 * 3. A panel's readings keep the emphasis the cards gave them — Rg, Ap, Jf,
 *    Volume, Surface Area and Mass stay at the top of their panel, not at the
 *    11px of the label that names them — while the parameters below stay at
 *    13px, because a parameter is a setting and a reading is a result.
 * 4. `Num` prints a missing or non-finite reading as an em dash, so readings
 *    the old cards printed as `N/A` now read `—`, and the mismatch notice's
 *    "current" dpo follows them instead of keeping a literal `N/A nm` beside
 *    an em dash in the same callout. That is a deviation from #176 — the
 *    contract says the result format does not change — approved explicitly by
 *    the issue owner after review: the dash is the kit's convention, R6 sends
 *    every number to `Num`, and one notice cannot speak two vocabularies. The
 *    unit goes with it when there is no magnitude to qualify, which is what
 *    `Num` already does for every other absent reading on the page.
 *
 * A local `Readout` carries the label/value pairs the cards used to hold:
 * `DetailList` would have been the kit's answer, but it is outside this
 * slice's surface, and a `<dl>` with one `dt`/`dd` per reading is the same
 * shape without reaching for it.
 */
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Callout } from '@/components/kit/Callout'
import { DataTable, type Column } from '@/components/kit/DataTable'
import { EmptyState } from '@/components/kit/EmptyState'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'
import { StatusChip } from '@/components/kit/StatusChip'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { fraktalApi } from '@/lib/api'
import type { FraktalAnalysis, CreateFraktalFromImageInput, CalibrationAttempt } from '@/lib/types'

interface FraktalResultsViewProps {
  analysis: FraktalAnalysis
  projectId: string
  onComparisonCreated?: (newAnalysis: FraktalAnalysis) => void
}

/**
 * How many decimals the record's own number carries.
 *
 * Parameters such as `delta`, `escala` or `m_exponent` arrive as whatever the
 * user typed; printing them at a fixed precision would invent digits the run
 * never had. The cap only bites float artefacts such as 0.30000000000000004.
 */
const digitsOf = (value: number): number => {
  if (Number.isInteger(value)) return 0
  return Math.min(String(value).split('.')[1]?.length ?? 0, 6)
}

/**
 * A signed difference, written the way the comparison column has always
 * written it: an explicit `+` for growth and no `-` for the negative case,
 * which `toFixed` already supplies.
 *
 * `Num` cannot produce this string — it has no signed presentation and its job
 * is value-plus-unit, not a signed delta — so the cell keeps this formatting
 * and only borrows the `.num` type treatment.
 */
const signed = (diff: number, digits: number): string =>
  (diff > 0 ? '+' : '') + diff.toFixed(digits)

/**
 * One label/value pair inside a panel.
 *
 * A `<dl>` wrapper with one `dt`/`dd` per reading: the label is the record's
 * own word and the reading next to it is always an element, so a number never
 * ends up glued to its unit in a single string.
 */
function Readout({ label, children, scale = 'md' }: {
  label: ReactNode
  children: ReactNode
  /**
   * `lg` for a reading the researcher copies out, `md` for a parameter.
   *
   * The `dd` class is what a non-numeric value inherits; a `Num` inside
   * declares its own size, so a call site that wants `lg` passes both — a
   * reading rendered at its label's 11px stops reading as a reading.
   */
  scale?: 'md' | 'lg'
}) {
  return (
    <div>
      <dt className="text-[11px] leading-relaxed text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'm-0 mt-1 font-semibold text-ink',
          scale === 'lg' ? 'text-[24px] leading-tight' : 'text-[13px]',
        )}
      >
        {children}
      </dd>
    </div>
  )
}

/** The grid every panel of readings uses. */
const READOUT_GRID = 'grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3'
const READOUT_GRID_WIDE = 'grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4'

/**
 * A ratio, as the two places that print one.
 *
 * `Num` is the product's reading primitive, but its formatter sends any nonzero
 * magnitude under 0.001 to `toExponential`, which is right for a measured
 * length and wrong for a ratio: `8.0e-4 x` is exactly the case that means "the
 * estimate is far off", and it should read as a small fixed-decimal multiplier
 * next to rows showing 0.80 and 1.00. The digits are fixed at two in the
 * sweep's table and in the mismatch notice alike — the notice used to print one
 * decimal for the same quantity, so it now prints `3.40x` where it printed
 * `3.4x` — and the unit keeps its own element, which is the rule `Num` exists to
 * enforce.
 */
function Ratio({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <Num value={null} unit="x" size="sm" />
  }
  return (
    <span className="inline-flex items-baseline gap-[0.28em]">
      <span className="num text-[11px] text-ink">{value.toFixed(2)}</span>
      <span className="num-unit">x</span>
    </span>
  )
}

/**
 * The word the engine's pick carries, painted with the kit's positive tokens.
 *
 * `Badge variant="success"` — what both markers used — spells its colour as
 * `bg-green-500 text-white`, which measures 2.28:1 on white in either theme. It
 * also replaced a `green-600` chip that passed in the dark theme on the near
 * black `--primary-foreground`, so the marker was a regression there rather
 * than an inherited fault. `border-success text-success bg-success-soft` is the
 * pair the kit already uses for a finished state: 5.03:1 on the light gold
 * panel, 5.63:1 on the dark one, 5.21:1 and 5.34:1 on the plain surfaces.
 */
function BestMarker({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="border-success bg-success-soft text-success">
      {children}
    </Badge>
  )
}

/** One row of the side-by-side comparison against the re-run. */
interface ComparisonRow {
  key: string
  metric: string
  original: ReactNode
  rerun: ReactNode
  change: ReactNode
}

export function FraktalResultsView({ analysis, projectId, onComparisonCreated }: FraktalResultsViewProps) {
  const { results, status, model, source_type } = analysis
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [rerunLoading, setRerunLoading] = useState(false)
  const [comparisonAnalysis, setComparisonAnalysis] = useState<FraktalAnalysis | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)

  // Load original image for uploaded_image source
  useEffect(() => {
    let blobUrl: string | null = null

    if (source_type === 'uploaded_image' && (status === 'completed' || status === 'failed')) {
      setImageLoading(true)
      fraktalApi.getOriginalImage(projectId, analysis.id)
        .then(blob => {
          blobUrl = URL.createObjectURL(blob)
          setImageUrl(blobUrl)
        })
        .catch(err => {
          console.error('Failed to load image:', err)
        })
        .finally(() => {
          setImageLoading(false)
        })
    }

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [source_type, status, projectId, analysis.id])

  // Poll for comparison analysis status
  useEffect(() => {
    if (!comparisonAnalysis) return
    if (comparisonAnalysis.status === 'completed' || comparisonAnalysis.status === 'failed') return

    const interval = setInterval(async () => {
      try {
        const updated = await fraktalApi.get(projectId, comparisonAnalysis.id)
        setComparisonAnalysis(updated)
        if (updated.status === 'completed' || updated.status === 'failed') {
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Failed to poll comparison analysis:', err)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [comparisonAnalysis, projectId])

  // Re-run analysis with suggested dpo
  const handleRerunWithSuggestedDpo = useCallback(async () => {
    if (!results?.dpo_estimated || source_type !== 'uploaded_image') return

    setRerunLoading(true)
    setComparisonError(null)

    try {
      // Get the original image as base64
      const imageBlob = await fraktalApi.getOriginalImage(projectId, analysis.id)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          const result = reader.result as string
          // Remove data URL prefix
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(imageBlob)
      })

      // Create new analysis with suggested dpo
      const newAnalysisData: CreateFraktalFromImageInput = {
        source_type: 'uploaded_image',
        image: base64,
        original_filename: analysis.original_filename || 'rerun_image.png',
        original_content_type: analysis.original_content_type || 'image/png',
        model: model as 'granulated_2012' | 'voxel_2018',
        npix: analysis.npix,
        dpo: Math.round(results.dpo_estimated),  // Use suggested dpo
        delta: analysis.delta,
        correction_3d: analysis.correction_3d,
        pixel_min: analysis.pixel_min,
        pixel_max: analysis.pixel_max,
        npo_limit: analysis.npo_limit,
        escala: analysis.escala,
      }

      const newAnalysis = await fraktalApi.create(projectId, newAnalysisData)
      setComparisonAnalysis(newAnalysis)
      onComparisonCreated?.(newAnalysis)
    } catch (err) {
      console.error('Failed to create comparison analysis:', err)
      setComparisonError(err instanceof Error ? err.message : 'Failed to create comparison analysis')
    } finally {
      setRerunLoading(false)
    }
  }, [results, source_type, projectId, analysis, model, onComparisonCreated])

  const handleDownloadCsv = useCallback(async () => {
    try {
      const blob = await fraktalApi.downloadSingleCsv(projectId, analysis.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fraktal-${analysis.id}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('CSV download failed:', err)
    }
  }, [projectId, analysis.id])

  const modelLabels: Record<string, string> = {
    granulated_2012: 'Granulated 2012',
    voxel_2018: 'Voxel 2018',
  }

  const sourceLabels: Record<string, string> = {
    uploaded_image: 'Uploaded Image',
    simulation_projection: 'Simulation Projection',
  }

  /**
   * The auto-calibration sweep, read as a table. The row the engine picked is
   * marked in the dpo cell instead of by tinting the whole row: `DataTable`
   * has no per-row class hook, and a marker survives greyscale where a green
   * background does not. The tolerance is the one the highlight used.
   */
  const isBestAttempt = (attempt: CalibrationAttempt): boolean =>
    Boolean(results?.best_dpo && Math.abs(attempt.dpo - results.best_dpo) < 0.1)

  const calibrationColumns: Column<CalibrationAttempt>[] = [
    {
      key: 'dpo',
      header: 'dpo',
      numeric: true,
      digits: 1,
      value: (attempt) => attempt.dpo,
      render: (attempt) => (
        <span className="inline-flex items-center justify-end gap-2">
          <Num value={attempt.dpo} unit="nm" digits={1} size="sm" />
          {isBestAttempt(attempt) && <BestMarker>Best</BestMarker>}
        </span>
      ),
    },
    {
      key: 'npo',
      header: 'Calculated npo',
      numeric: true,
      digits: 0,
      value: (attempt) => attempt.npo,
    },
    {
      key: 'ratio',
      header: 'Ratio',
      numeric: true,
      render: (attempt) => <Ratio value={attempt.npo_ratio} />,
    },
    {
      key: 'aligned',
      header: 'Aligned',
      render: (attempt) => (
        <Badge variant={attempt.npo_aligned ? 'default' : 'secondary'}>
          {attempt.npo_aligned ? 'Yes' : 'No'}
        </Badge>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Status header: the record's identity, its export and its own state. */}
      <Panel
        title="FRAKTAL Analysis Results"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {status === 'completed' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadCsv}
                aria-label="Download CSV"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            )}
            <Badge variant="outline">{modelLabels[model]}</Badge>
            <Badge variant="secondary">{sourceLabels[source_type]}</Badge>
            <StatusChip status={status} />
          </div>
        }
      >
        <dl className={READOUT_GRID_WIDE}>
          <Readout label="Created">
            {new Date(analysis.created_at).toLocaleString()}
          </Readout>
          {analysis.completed_at && (
            <Readout label="Completed">
              {new Date(analysis.completed_at).toLocaleString()}
            </Readout>
          )}
          {analysis.execution_time_ms && (
            <Readout label="Execution Time">
              <Num value={analysis.execution_time_ms} digits={0} unit="ms" size="sm" />
            </Readout>
          )}
          {analysis.engine_version && (
            <Readout label="Engine">aglogen_core {analysis.engine_version}</Readout>
          )}
        </dl>
      </Panel>

      {/* Original image */}
      {source_type === 'uploaded_image' && (
        <Panel title="Analyzed Image">
          {imageLoading ? (
            <div className="flex h-64 items-center justify-center rounded-lg bg-surface-soft">
              <LoadingSpinner size="md" />
            </div>
          ) : imageUrl ? (
            <div className="flex justify-center">
              <img
                src={imageUrl}
                alt="Analyzed aggregate"
                className="max-h-96 rounded-lg border border-line object-contain"
              />
            </div>
          ) : (
            <EmptyState
              headingLevel={3}
              title="Image not available"
              description="The image this analysis was run on could not be read back from the server."
            />
          )}
          {analysis.original_filename && (
            <p className="mt-2 text-center text-[12px] text-ink-muted">
              {analysis.original_filename}
            </p>
          )}
        </Panel>
      )}

      {/* Failure. The engine's own message is the body: it is the only thing
          that says what went wrong. */}
      {status === 'failed' && analysis.error_message && (
        <Callout tone="danger" title="Analysis Failed">
          {analysis.error_message}
        </Callout>
      )}

      {/* Parameter mismatch. A warning, not an error: the run has numbers, the
          numbers are suspect, and the way out is the re-run this callout
          carries. */}
      {results && results.npo_aligned === false && results.npo_visual > 5 && !comparisonAnalysis && (
        <Callout
          tone="warning"
          title="Parameter Mismatch Detected"
          action={
            source_type === 'uploaded_image' && results.dpo_estimated > 0 ? (
              <Button
                onClick={handleRerunWithSuggestedDpo}
                disabled={rerunLoading}
                variant="outline"
              >
                {rerunLoading ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Re-running...
                  </>
                ) : (
                  <>Re-run with dpo = {Math.round(results.dpo_estimated)} nm</>
                )}
              </Button>
            ) : undefined
          }
        >
          <p>
            Calculated particles (<Num value={results.npo ?? null} digits={0} size="sm" />)
            differs significantly from visual estimate (
            <Num value={results.npo_visual} digits={0} size="sm" />)
            {results.npo_ratio != null && results.npo_ratio > 0 && (
              <> - ratio: <Ratio value={results.npo_ratio} /></>
            )}
          </p>
          {results.dpo_estimated != null && results.dpo_estimated > 0 && (
            <p className="font-medium">
              Suggested dpo: <Num value={results.dpo_estimated} digits={1} unit="nm" size="sm" />{' '}
              (current:{' '}
              {/* A dpo the record does not carry is the kit's em dash, like every
                  other absent reading; `Num` withholds the unit because there is
                  no magnitude for it to qualify. */}
              <Num
                value={analysis.dpo ?? null}
                digits={analysis.dpo == null ? 0 : digitsOf(analysis.dpo)}
                unit="nm"
                size="sm"
              />
              )
            </p>
          )}
          {comparisonError && <p className="text-danger">{comparisonError}</p>}
        </Callout>
      )}

      {/* Results */}
      {results && (
        <>
          {/* The headline readings. Every one of them is an estimate the model
              reported, so every one declares that the record ships no
              uncertainty for it rather than leaving the field blank. */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard
              kind="measured"
              tone="violet"
              label="Fractal Dimension (Df)"
              value={results.df ?? null}
              sigma={null}
              digits={4}
              detail="FRAKTAL estimate of the projection's dimension; the record reports no uncertainty for it"
            />
            <MetricCard
              kind="measured"
              tone="teal"
              label="Prefactor (kf)"
              value={results.kf ?? null}
              sigma={null}
              digits={4}
              detail="Prefactor of the same power law; the record reports no uncertainty for it"
            />
            <MetricCard
              kind="exact"
              tone="gold"
              label="Primary Particles (npo)"
              value={results.npo ?? null}
              digits={0}
              detail={
                results.npo_visual > 0 ? `~${results.npo_visual} visual estimate` : undefined
              }
            />
            <MetricCard
              kind="measured"
              tone="slate"
              label="Overlap Exponent (zf)"
              value={results.zf ?? null}
              sigma={null}
              digits={4}
              detail="Overlap exponent; the record reports no uncertainty for it"
            />
          </div>

          {/* Geometry. These are readings, not parameters, so they keep the
              emphasis the cards gave them (24px, and `lg` on the number). */}
          <Panel title="Geometry">
            <dl className={READOUT_GRID}>
              <Readout label="Radius of Gyration (Rg)" scale="lg">
                <Num value={results.rg ?? null} digits={2} unit="nm" size="lg" />
              </Readout>
              <Readout label="Projected Area (Ap)" scale="lg">
                <Num value={results.ap ?? null} digits={2} unit="nm²" size="lg" />
              </Readout>
              {results.jf !== null && (
                <Readout label="Coordination Index (Jf)" scale="lg">
                  <Num value={results.jf} digits={4} size="lg" />
                </Readout>
              )}
            </dl>
          </Panel>

          {/* Physical properties */}
          <Panel title="Physical Properties">
            <dl className={READOUT_GRID}>
              <Readout label="Volume" scale="lg">
                <Num value={results.volume ?? null} digits={2} unit="nm³" size="lg" />
              </Readout>
              <Readout label="Surface Area" scale="lg">
                <Num value={results.surface_area ?? null} digits={2} unit="nm²" size="lg" />
              </Readout>
              {results.mass > 0 && (
                <Readout label="Mass" scale="lg">
                  <Num value={results.mass} digits={2} unit="fg" size="lg" />
                </Readout>
              )}
            </dl>
          </Panel>

          {/* What the analysis was asked for */}
          <Panel title="Analysis Parameters">
            <dl className={READOUT_GRID_WIDE}>
              <Readout label="npix">
                <Num value={analysis.npix} digits={digitsOf(analysis.npix)} unit="px/100nm" size="sm" />
              </Readout>
              <Readout label="Scale">
                <Num value={analysis.escala} digits={digitsOf(analysis.escala)} unit="nm" size="sm" />
              </Readout>
              {model === 'granulated_2012' && analysis.dpo && (
                <Readout label="dpo">
                  <Num value={analysis.dpo} digits={digitsOf(analysis.dpo)} unit="nm" size="sm" />
                </Readout>
              )}
              <Readout label="Delta">
                <Num value={analysis.delta} digits={digitsOf(analysis.delta)} size="sm" />
              </Readout>
              <Readout label="3D Correction">
                {analysis.correction_3d ? 'Yes' : 'No'}
              </Readout>
              <Readout label="Pixel Range">
                <span className="inline-flex items-baseline gap-1.5">
                  <Num value={analysis.pixel_min} digits={digitsOf(analysis.pixel_min)} size="sm" />
                  <span className="text-ink-muted">-</span>
                  <Num value={analysis.pixel_max} digits={digitsOf(analysis.pixel_max)} size="sm" />
                </span>
              </Readout>
              {model === 'granulated_2012' && (
                <Readout label="npo Limit">
                  <Num value={analysis.npo_limit} digits={digitsOf(analysis.npo_limit)} size="sm" />
                </Readout>
              )}
              {model === 'voxel_2018' && (
                <Readout label="m Exponent">
                  <Num value={analysis.m_exponent} digits={digitsOf(analysis.m_exponent)} size="sm" />
                </Readout>
              )}
              {analysis.auto_calibrate && (
                <Readout label="Auto-calibrate">
                  <span className="text-warning">Enabled</span>
                </Readout>
              )}
            </dl>
          </Panel>

          {/* Auto-calibration sweep */}
          {results.calibration_attempts && results.calibration_attempts.length > 0 && (
            <Panel tone="gold" title="Auto-Calibration Results">
              {results.best_dpo && (
                <div className="mb-4 flex flex-wrap items-center gap-4 rounded-md bg-surface-strong p-3">
                  <span className="text-[12px] font-semibold text-ink">Optimal dpo found:</span>
                  <Num value={results.best_dpo} digits={1} unit="nm" size="lg" />
                  <BestMarker>Best Match</BestMarker>
                </div>
              )}
              <DataTable
                columns={calibrationColumns}
                rows={results.calibration_attempts}
                caption="Every dpo the auto-calibration tried, with the particle count it produced."
                emptyMessage="No calibration attempts were recorded."
              />
              <p className="hint mt-3">
                Visual estimate: {results.npo_visual} particles.
                Ratio near 1.0 indicates good alignment between calculated and visual particle count.
              </p>
            </Panel>
          )}

          {/* Projection parameters, when the source was a simulation */}
          {source_type === 'simulation_projection' && analysis.projection_params && (
            <Panel title="Projection Parameters">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
                <Readout label="Azimuth">
                  <Num value={analysis.projection_params.azimuth} digits={0} unit="°" size="sm" />
                </Readout>
                <Readout label="Elevation">
                  <Num value={analysis.projection_params.elevation} digits={0} unit="°" size="sm" />
                </Readout>
                <Readout label="Resolution">
                  <Num value={analysis.projection_params.resolution} digits={0} unit="px" size="sm" />
                </Readout>
              </dl>
            </Panel>
          )}
        </>
      )}

      {/* Queued and running are states, so they read as notices. */}
      {(status === 'queued' || status === 'running') && (
        <Callout
          tone="info"
          title={status === 'queued' ? 'Analysis queued...' : 'Running FRAKTAL analysis...'}
        />
      )}

      {/* Comparison against the re-run with the suggested dpo */}
      {comparisonAnalysis && (
        <Panel
          tone="navy"
          title="Comparison: Re-run with Suggested dpo"
          action={<StatusChip status={comparisonAnalysis.status} />}
        >
          {(comparisonAnalysis.status === 'queued' || comparisonAnalysis.status === 'running') && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <LoadingSpinner size="md" />
              <p className="text-[12px] text-ink-muted">
                {comparisonAnalysis.status === 'queued' ? 'Analysis queued...' : 'Running comparison...'}
              </p>
            </div>
          )}

          {comparisonAnalysis.status === 'failed' && (
            <p className="text-danger">
              {comparisonAnalysis.error_message || 'Analysis failed'}
            </p>
          )}

          {comparisonAnalysis.status === 'completed' && comparisonAnalysis.results && (
            <div className="space-y-4">
              <DataTable
                columns={[
                  { key: 'metric', header: 'Metric', value: (row: ComparisonRow) => row.metric },
                  {
                    key: 'original',
                    header: `Original (dpo=${analysis.dpo})`,
                    numeric: true,
                    render: (row: ComparisonRow) => row.original,
                  },
                  {
                    key: 'rerun',
                    header: `Re-run (dpo=${comparisonAnalysis.dpo})`,
                    numeric: true,
                    render: (row: ComparisonRow) => row.rerun,
                  },
                  {
                    key: 'change',
                    header: 'Change',
                    numeric: true,
                    render: (row: ComparisonRow) => row.change,
                  },
                ]}
                rows={[
                  {
                    key: 'df',
                    metric: 'Fractal Dimension (Df)',
                    original: <Num value={results?.df ?? null} digits={4} size="sm" />,
                    rerun: <Num value={comparisonAnalysis.results.df ?? null} digits={4} size="sm" />,
                    change:
                      results?.df && comparisonAnalysis.results.df ? (
                        <span className="num text-[11px] text-ink-muted">
                          {signed(comparisonAnalysis.results.df - results.df, 4)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">-</span>
                      ),
                  },
                  {
                    key: 'npo',
                    metric: 'Primary Particles (npo)',
                    original: <Num value={results?.npo ?? null} digits={0} size="sm" />,
                    rerun: <Num value={comparisonAnalysis.results.npo ?? null} digits={0} size="sm" />,
                    change:
                      results?.npo && comparisonAnalysis.results.npo ? (
                        <span className="num text-[11px] text-ink-muted">
                          {(comparisonAnalysis.results.npo > results.npo ? '+' : '') +
                            (comparisonAnalysis.results.npo - results.npo).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">-</span>
                      ),
                  },
                  {
                    key: 'npo_visual',
                    metric: 'Visual Estimate',
                    original: <Num value={results?.npo_visual ?? null} digits={0} size="sm" />,
                    rerun: (
                      <Num value={comparisonAnalysis.results.npo_visual ?? null} digits={0} size="sm" />
                    ),
                    change: <span className="text-[11px] text-ink-muted">-</span>,
                  },
                  {
                    key: 'aligned',
                    metric: 'NPO Aligned',
                    original: (
                      <Badge variant={results?.npo_aligned ? 'default' : 'destructive'}>
                        {results?.npo_aligned ? 'Yes' : 'No'}
                      </Badge>
                    ),
                    rerun: (
                      <Badge
                        variant={comparisonAnalysis.results.npo_aligned ? 'default' : 'destructive'}
                      >
                        {comparisonAnalysis.results.npo_aligned ? 'Yes' : 'No'}
                      </Badge>
                    ),
                    change:
                      !results?.npo_aligned && comparisonAnalysis.results.npo_aligned ? (
                        <span className="text-success">✓ Fixed</span>
                      ) : null,
                  },
                  {
                    key: 'kf',
                    metric: 'Prefactor (kf)',
                    original: <Num value={results?.kf ?? null} digits={4} size="sm" />,
                    rerun: <Num value={comparisonAnalysis.results.kf ?? null} digits={4} size="sm" />,
                    change:
                      results?.kf && comparisonAnalysis.results.kf ? (
                        <span className="num text-[11px] text-ink-muted">
                          {signed(comparisonAnalysis.results.kf - results.kf, 4)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">-</span>
                      ),
                  },
                  {
                    key: 'zf',
                    metric: 'Overlap Exponent (zf)',
                    original: <Num value={results?.zf ?? null} digits={4} size="sm" />,
                    rerun: <Num value={comparisonAnalysis.results.zf ?? null} digits={4} size="sm" />,
                    change:
                      results?.zf && comparisonAnalysis.results.zf ? (
                        <span className="num text-[11px] text-ink-muted">
                          {signed(comparisonAnalysis.results.zf - results.zf, 4)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">-</span>
                      ),
                  },
                ]}
                rowKey={(row) => row.key}
                caption="The original run and the re-run with the suggested dpo, metric by metric: what each produced and how far the second moved."
              />

              {comparisonAnalysis.results.npo_aligned && !results?.npo_aligned && (
                <Callout tone="success" title="Success!">
                  The re-run with suggested dpo produces results that align with the visual
                  particle count.
                </Callout>
              )}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
