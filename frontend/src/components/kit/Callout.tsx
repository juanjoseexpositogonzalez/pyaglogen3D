'use client'

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * An inline notice that names a condition.
 *
 * This is where state lives, together with `StatusChip`. A panel tone never
 * carries meaning; a callout always does. Every tone pairs its colour with an
 * icon and a title, so the state survives greyscale and colour blindness.
 *
 * Used for unit conventions, parameter mismatches and estimator caveats: the
 * cases where the product must say out loud that a number means less than it
 * appears to.
 */
export type CalloutTone = 'info' | 'success' | 'warning' | 'danger'

const TONES: Record<CalloutTone, { ring: string; ink: string; bg: string; Icon: typeof Info }> = {
  info: { ring: 'border-line-strong', ink: 'text-ink', bg: 'bg-surface-soft', Icon: Info },
  success: {
    ring: 'border-success',
    ink: 'text-success',
    bg: 'bg-success-soft',
    Icon: CheckCircle2,
  },
  warning: {
    ring: 'border-warning',
    ink: 'text-warning',
    bg: 'bg-warning-soft',
    Icon: AlertTriangle,
  },
  danger: { ring: 'border-danger', ink: 'text-danger', bg: 'bg-danger-soft', Icon: XCircle },
}

export interface CalloutProps {
  tone?: CalloutTone
  title: ReactNode
  children?: ReactNode
  /** Optional action, e.g. "Re-run with suggested dpo". */
  action?: ReactNode
  className?: string
}

export function Callout({ tone = 'info', title, children, action, className }: CalloutProps) {
  const { ring, ink, bg, Icon } = TONES[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn('flex gap-3 rounded-md border p-3.5', ring, bg, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ink)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn('m-0 text-[12.5px] font-semibold', ink)}>{title}</p>
        {children && <div className="mt-1 text-[12px] leading-relaxed text-ink-muted">{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  )
}

export default Callout
