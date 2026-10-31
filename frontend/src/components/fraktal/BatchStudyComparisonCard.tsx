'use client'

/**
 * BatchStudyComparisonCard — batch vs its linked simulation (R12, change
 * fraktal-batch-extensions), on the design-system kit.
 *
 * REPLACES FraktalComparisonCard at the SHARED swap point in
 * FraktalBatchResultsView (R12.3): exactly one comparison card and the
 * canonical R11 Sorensen note EXACTLY ONCE per page. All values come from
 * the `study_comparison` block ONLY — the legacy `comparison` block is not
 * a source. Rendered when `study_comparison` is non-null; the null branch
 * shows NO card and NO legacy fallback (that would reintroduce the 0.0
 * rendering the sentinel rule exists to fix).
 *
 * The five figures are `MetricCard`s so value, unit and precision are separate
 * elements, and each `data-testid` stays on the wrapper that holds one: the
 * R12.3 tests, and the swap-point test that lives in FraktalBatchResultsView,
 * key off those ids rather than off the markup underneath them.
 *
 * Heading order is the one thing this card cannot fix from where it sits: it
 * introduces an `h2` (the panel title) into a host page whose own headings are
 * still `h3`, so the outline reads h1 → h3 → h3 → h2 → h3. The host
 * (`FraktalBatchResultsView`) belongs to slice 3; until that lands, this card
 * sits one level above its neighbours. Recorded here so the disorder reads as
 * the price of migrating the card first, not as the intended outline.
 *
 * The hint names Df, because Df is what the card shows. "Image dimensions"
 * would read as a pixel size in a product where dimension already means
 * fractal dimension.
 */
import { Callout } from '@/components/kit/Callout'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'
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

export function BatchStudyComparisonCard({
  studyComparison,
}: BatchStudyComparisonCardProps) {
  const { image_df, sim_df, mean_delta } = studyComparison

  return (
    <Panel
      title="Study Comparison"
      hint="The batch's image Df statistics against the Df of the simulation it was linked to."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Contributing image values (converged + approximate, canonical R7) */}
        <div data-testid="study-comparison-images-with-df">
          <MetricCard
            kind="exact"
            tone="slate"
            label="Images with Df"
            value={image_df.n}
            digits={0}
            detail={
              <span>
                {image_df.n_converged} converged · {image_df.n_approximate} approximate
              </span>
            }
          />
        </div>

        {/* Batch image Df stats over the contributors */}
        <div data-testid="study-comparison-image-mean">
          <MetricCard
            kind="measured"
            tone="violet"
            label="Batch image Df mean"
            value={image_df.mean}
            sigma={null}
            digits={3}
            detail={
              <span>
                median <Num value={image_df.median} digits={2} size="sm" /> · min{' '}
                <Num value={image_df.min} digits={2} size="sm" /> · max{' '}
                <Num value={image_df.max} digits={2} size="sm" />
              </span>
            }
          />
        </div>

        {/* Simulation Df — the single source for the C2 marker */}
        <div data-testid="study-comparison-sim-df">
          <MetricCard
            kind="measured"
            tone="teal"
            label="Sim Df"
            value={sim_df.value}
            sigma={null}
            digits={3}
            detail={
              <span>
                target <Num value={sim_df.target_df} digits={3} size="sm" />
              </span>
            }
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div data-testid="study-comparison-mean-delta">
          <MetricCard
            kind="measured"
            tone="gold"
            label="Mean delta (image − sim)"
            value={mean_delta}
            sigma={null}
            digits={3}
            detail="Image minus simulation, averaged per image: negative means the projection sits below the simulation"
          />
        </div>
        <div data-testid="study-comparison-images-without-df">
          <MetricCard
            kind="exact"
            label="Images without Df"
            value={studyComparison.images_without_df}
            digits={0}
            detail="Left out of the statistics above"
          />
        </div>
      </div>

      {studyComparison.show_sorensen_note && (
        <div data-testid="study-comparison-sorensen-note" className="mt-3">
          <Callout tone="info" title="Sorensen note">
            {SORENSEN_NOTE}
          </Callout>
        </div>
      )}
    </Panel>
  )
}

export default BatchStudyComparisonCard
