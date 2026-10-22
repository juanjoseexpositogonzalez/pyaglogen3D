'use client'

import { cn } from '@/lib/utils'

/**
 * A 7px dot with a soft halo, for inline list states where a full chip would
 * crowd the row.
 *
 * It is never the only carrier of meaning: the dot takes a required `label`
 * that assistive technology reads and that a sighted user gets on hover, and
 * it is meant to sit beside text that already says the same thing.
 */
export type DotTone = 'positive' | 'negative' | 'warning' | 'neutral'

const STYLES: Record<DotTone, string> = {
  positive: 'bg-success shadow-[0_0_0_3px_var(--success-soft)]',
  negative: 'bg-danger shadow-[0_0_0_3px_var(--danger-soft)]',
  warning: 'bg-warning shadow-[0_0_0_3px_var(--warning-soft)]',
  neutral: 'bg-ink-faint shadow-[0_0_0_3px_var(--surface-soft)]',
}

export interface StatusDotProps {
  tone: DotTone
  /** Required: the dot alone conveys nothing. */
  label: string
  className?: string
}

export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span
      title={label}
      className={cn('inline-block h-[7px] w-[7px] shrink-0 rounded-full', STYLES[tone], className)}
    >
      <span className="sr-only">{label}</span>
    </span>
  )
}

export default StatusDot
