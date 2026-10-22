'use client'

import { cn } from '@/lib/utils'

/**
 * How much a measured result can be trusted.
 *
 * Distinct from `StatusChip`: a FRAKTAL analysis can complete successfully and
 * still yield an approximate or excluded result. Conflating "the job finished"
 * with "the number is usable" is how a bad measurement reaches a paper.
 *
 * `reason` is required for anything other than `good`. An exclusion the user
 * cannot interrogate is an exclusion that will be mistaken for a bug.
 */
export type Quality = 'good' | 'approximate' | 'excluded' | 'failed'

const LABELS: Record<Quality, string> = {
  good: 'Good',
  approximate: 'Approximate',
  excluded: 'Excluded',
  failed: 'Failed',
}

const STYLES: Record<Quality, string> = {
  good: 'border-success text-success bg-success-soft',
  approximate: 'border-warning text-warning bg-warning-soft',
  excluded: 'border-line-strong text-ink-muted bg-surface-soft',
  failed: 'border-danger text-danger bg-danger-soft',
}

export type QualityBadgeProps =
  | { quality: 'good'; reason?: string; className?: string }
  | { quality: Exclude<Quality, 'good'>; reason: string; className?: string }

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
