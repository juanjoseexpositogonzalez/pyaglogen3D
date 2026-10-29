'use client'

/**
 * BatchStudyComparisonCard — batch vs its linked simulation (R12, change
 * fraktal-batch-extensions).
 *
 * REPLACES FraktalComparisonCard at the SHARED swap point in
 * FraktalBatchResultsView (R12.3): exactly one comparison card and the
 * canonical R11 Sorensen note EXACTLY ONCE per page. All values come from
 * the `study_comparison` block ONLY — the legacy `comparison` block is not
 * a source. Rendered when `study_comparison` is non-null; the null branch
 * shows NO card and NO legacy fallback (that would reintroduce the 0.0
 * rendering the sentinel rule exists to fix).
 */
import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FraktalStudyComparison } from '@/lib/api'

// Canonical R11 Sorensen note (fixed text). The study_comparison block
// carries only the `show_sorensen_note` boolean, so the text lives here.
const SORENSEN_NOTE =
  'Note: 2D projection fractal dimension is systematically lower than ' +
  'the 3D aggregate Df (Sorensen 1992). Typical gap: 0.1–0.3. ' +
  'This is expected and does NOT indicate simulation error.'

interface BatchStudyComparisonCardProps {
  studyComparison: FraktalStudyComparison
}

function formatDf(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : v.toFixed(digits)
}

export function BatchStudyComparisonCard({
  studyComparison,
}: BatchStudyComparisonCardProps) {
  const { image_df, sim_df, mean_delta } = studyComparison

  return (
    <Card>
      <CardHeader>
        <CardTitle>Study Comparison</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {/* Contributing image values (converged + approximate, canonical R7) */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">
              Images with Df
            </div>
            <div
              className="text-xl font-mono font-semibold"
              data-testid="study-comparison-images-with-df"
            >
              {image_df.n}
            </div>
            <div className="text-xs text-muted-foreground">
              {image_df.n_converged} converged · {image_df.n_approximate}{' '}
              approximate
            </div>
          </div>

          {/* Batch image Df stats over the contributors */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">
              Batch image Df mean
            </div>
            <div
              className="text-xl font-mono font-semibold"
              data-testid="study-comparison-image-mean"
            >
              {formatDf(image_df.mean)}
            </div>
            <div className="text-xs text-muted-foreground">
              median {formatDf(image_df.median, 2)} · min{' '}
              {formatDf(image_df.min, 2)} · max {formatDf(image_df.max, 2)}
            </div>
          </div>

          {/* Simulation Df — the single source for the C2 marker */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Sim Df</div>
            <div
              className="text-xl font-mono font-semibold"
              data-testid="study-comparison-sim-df"
            >
              {formatDf(sim_df.value)}
            </div>
            <div className="text-xs text-muted-foreground">
              target {formatDf(sim_df.target_df)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">
              Mean delta (image − sim)
            </div>
            <div
              className="text-xl font-mono font-semibold"
              data-testid="study-comparison-mean-delta"
            >
              {formatDf(mean_delta)}
            </div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">
              Images without Df
            </div>
            <div
              className="text-xl font-mono font-semibold"
              data-testid="study-comparison-images-without-df"
            >
              {studyComparison.images_without_df}
            </div>
          </div>
        </div>

        {studyComparison.show_sorensen_note && (
          <div
            className="bg-muted/50 rounded-lg p-3 text-xs flex gap-2"
            data-testid="study-comparison-sorensen-note"
          >
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{SORENSEN_NOTE}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default BatchStudyComparisonCard
