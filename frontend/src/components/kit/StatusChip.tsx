'use client'

import type { SimulationStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The state of a job, as a pill that always carries a word.
 *
 * Status is never conveyed by colour alone: the label is the state, the colour
 * reinforces it. `running` adds a slow shimmer, suppressed under
 * `prefers-reduced-motion` by the `.shimmer` rule itself.
 *
 * The state union is `SimulationStatus` from `lib/types.ts`, not a vocabulary
 * of this component's own. An earlier version invented `ready`, `error` and
 * `attention`; the backend says `completed`, `failed` and has no `attention`
 * at all, so porting a real screen would either fail type-checking or render a
 * blank chip. The product's types are the source of truth, and `AnalysisStatus`
 * shares this exact union.
 *
 * Covers design-system-foundation R8.
 */
export type Status = SimulationStatus

const LABELS: Record<Status, string> = {
  completed: 'Completed',
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const STYLES: Record<Status, string> = {
  completed: 'border-success text-success bg-success-soft',
  running: 'border-brand text-brand-strong bg-brand-soft',
  queued: 'border-line-strong text-ink-muted bg-surface-soft',
  failed: 'border-danger text-danger bg-danger-soft',
  cancelled: 'border-line-strong text-ink-faint bg-surface-soft',
}

export interface StatusChipProps {
  status: Status
  /** Overrides the default word; the chip is never wordless. */
  label?: string
  className?: string
}

export function StatusChip({ status, label, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        'relative inline-flex items-center overflow-hidden rounded-full border px-2.5 py-0.5',
        'text-[10px] font-extrabold uppercase tracking-[0.06em]',
        STYLES[status],
        className,
      )}
    >
      {status === 'running' && (
        <span className="shimmer pointer-events-none absolute inset-0" aria-hidden="true" />
      )}
      <span className="relative">{label ?? LABELS[status]}</span>
    </span>
  )
}

export default StatusChip
