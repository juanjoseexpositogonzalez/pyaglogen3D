'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The workhorse surface: a titled block with an optional action on the right
 * and an optional hint under the title.
 *
 * `tone` tints the background with one of the tonal gradients. The convention
 * the product follows: teal for computation, violet for analysis and AI, gold
 * for attention, navy for reference, slate for neutral. A tone is decoration,
 * never state; state belongs to `StatusChip` and `Callout`.
 */
export type Tone = 'plain' | 'teal' | 'violet' | 'gold' | 'navy' | 'slate'

const TONE_BG: Record<Tone, string> = {
  plain: 'bg-surface-strong',
  teal: 'bg-panel-teal',
  violet: 'bg-panel-violet',
  gold: 'bg-panel-gold',
  navy: 'bg-panel-navy',
  slate: 'bg-panel-slate',
}

export interface PanelProps {
  title?: ReactNode
  /** One line explaining what the panel shows, in muted 11px. */
  hint?: ReactNode
  /** Right-aligned control: a link, a segmented control, a Show values toggle. */
  action?: ReactNode
  tone?: Tone
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({
  title,
  hint,
  action,
  tone = 'plain',
  children,
  className,
  bodyClassName,
}: PanelProps) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg border border-line p-[21px] shadow-panel',
        TONE_BG[tone],
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-[14px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
            )}
            {hint && <p className="hint mt-1.5 max-w-[62ch]">{hint}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
    </section>
  )
}

export default Panel
