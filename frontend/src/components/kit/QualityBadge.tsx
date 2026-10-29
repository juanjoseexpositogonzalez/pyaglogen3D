'use client'

import type { AnalysisQuality } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * How much a measured result can be trusted.
 *
 * Distinct from `StatusChip`: a FRAKTAL analysis can complete successfully and
 * still yield an approximate or excluded result. Conflating "the job finished"
 * with "the number is usable" is how a bad measurement reaches a paper.
 *
 * `reason` is required for anything other than `converged`. An exclusion the
 * user cannot interrogate is an exclusion that will be mistaken for a bug.
 *
 * The union is `AnalysisQuality` from `lib/api.ts`, not a vocabulary of this
 * component's own: the backend says `converged`, and an earlier version here
 * said `good`, which no FRAKTAL consumer could have passed without a cast.
 *
 * The label differs from `StatusChip`'s on purpose. Both unions contain
 * `failed`, and in a FRAKTAL row the two badges sit side by side; saying
 * "Failed" twice for different things helps nobody.
 */
export type Quality = AnalysisQuality

const LABELS: Record<Quality, string> = {
  converged: 'Converged',
  approximate: 'Approximate',
  excluded: 'Excluded',
  failed: 'Unusable',
}

const STYLES: Record<Quality, string> = {
  converged: 'border-success text-success bg-success-soft',
  approximate: 'border-warning text-warning bg-warning-soft',
  excluded: 'border-line-strong text-ink-muted bg-surface-soft',
  failed: 'border-danger text-danger bg-danger-soft',
}

export type QualityBadgeProps =
  | { quality: 'converged'; reason?: string; className?: string }
  | { quality: Exclude<Quality, 'converged'>; reason: string; className?: string }

export function QualityBadge({ quality, reason, className }: QualityBadgeProps) {
  return (
    <span
      title={reason}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5',
        'text-[10px] font-extrabold uppercase tracking-[0.06em]',
        STYLES[quality],
        className,
      )}
    >
      {LABELS[quality]}
      {reason && <span className="sr-only">: {reason}</span>}
    </span>
  )
}

export default QualityBadge
