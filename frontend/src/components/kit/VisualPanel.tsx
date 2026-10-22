'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The dark stage for anything rendered spatially: the 3D viewer, the topology
 * graph, a projection, a micrograph.
 *
 * Its background stays near-black in both themes. That is the signature of this
 * design system: light chrome, dark instruments. If the visualisation canvas
 * followed the theme, a rendered aggregate would stop standing out from the
 * interface around it.
 *
 * The caption bar is glass over the canvas and carries live readouts, so the
 * numbers that describe what is on screen sit on the same surface as the thing
 * they describe.
 */
export interface Readout {
  label: string
  value: ReactNode
}

export interface VisualPanelProps {
  title?: ReactNode
  /** Live values shown in the caption bar, right-aligned. */
  readouts?: Readout[]
  /** Overlay controls, positioned by the caller inside the stage. */
  overlay?: ReactNode
  /** Rendered in the panel header, typically the Show values toggle. */
  action?: ReactNode
  height?: number
  children: ReactNode
  className?: string
}

export function VisualPanel({
  title,
  readouts,
  overlay,
  action,
  height = 420,
  children,
  className,
}: VisualPanelProps) {
  return (
    <section className={cn('min-w-0', className)}>
      {(title || action) && (
        <header className="mb-2 flex items-center justify-between gap-4">
          {title && <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>}
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}

      <div
        className="relative overflow-hidden rounded-lg border border-visual-border bg-visual shadow-panel"
        style={{ height }}
      >
        {children}
        {overlay}

        {readouts && readouts.length > 0 && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-baseline justify-between gap-4 rounded-md border border-visual-border bg-visual-caption px-3 py-2 backdrop-blur-md">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-on-dark/70">
              {title}
            </span>
            <span className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
              {readouts.map((r) => (
                <span key={r.label} className="inline-flex items-baseline gap-1.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-ink-on-dark/60">
                    {r.label}
                  </span>
                  <span className="num text-[11.5px] text-ink-on-dark">{r.value}</span>
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

export default VisualPanel
