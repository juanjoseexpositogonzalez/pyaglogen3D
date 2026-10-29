'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * What a surface shows before it has anything to show.
 *
 * The explanation is not optional: an empty state that only says "no items"
 * teaches nothing. It should say what the thing is for, so a researcher
 * arriving at an unfamiliar screen learns what it would hold.
 */
export interface EmptyStateProps {
  icon?: LucideIcon
  title: ReactNode
  /** What this surface is for, not merely that it is empty. */
  description: ReactNode
  action?: ReactNode
  /**
   * Heading level for the title. Required, with no default: an empty state
   * sits wherever its page puts it, and a fixed level would be wrong for
   * half the call sites. The projects list hangs off the page `h1`; the
   * dashboard's sits inside a section that already has an `h2`.
   */
  headingLevel: 2 | 3 | 4
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center',
        className,
      )}
    >
      {Icon && <Icon className="h-7 w-7 text-ink-faint" aria-hidden="true" />}
      <Heading className="m-0 text-[15px] font-semibold text-ink">{title}</Heading>
      <p className="m-0 max-w-[48ch] text-[12px] leading-relaxed text-ink-muted">{description}</p>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}

export default EmptyState
