'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The top of every page: an eyebrow naming the context, the title, a short
 * description, a meta row for identity, and a right-aligned action cluster.
 *
 * The meta row is where reproducibility lives on a result page: algorithm,
 * particle count, seed and timestamp sit together, under the title, before any
 * metric.
 */
export interface PageHeaderProps {
  /** Small tracked uppercase context, e.g. `SIMULATION`. */
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  /** Identity row: chips, counts, seed, timestamp, status. */
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="m-0 text-[clamp(28px,4vw,39px)] font-bold leading-[1.05] tracking-[-0.04em] text-ink">
          {title}
        </h1>
        {meta && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-muted">
            {meta}
          </div>
        )}
        {description && (
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export default PageHeader
