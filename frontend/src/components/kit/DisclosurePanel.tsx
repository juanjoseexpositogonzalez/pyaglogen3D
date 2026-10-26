'use client'

import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A collapsible section, for advanced parameters and for recaps that should be
 * available without competing for attention.
 *
 * Built on a native button plus `aria-expanded` and `aria-controls` rather
 * than `<details>`, and it supports both modes: uncontrolled through
 * `defaultOpen`, or controlled through `open` and `onOpenChange`.
 *
 * The controlled mode is the one that earns the component: a validation error
 * summary needs to open the collapsed section it points into, which an
 * initial-value-only API cannot do.
 */
export interface DisclosurePanelProps {
  title: ReactNode
  hint?: ReactNode
  /** Initial state when uncontrolled. Ignored when `open` is supplied. */
  defaultOpen?: boolean
  /** Controlled state. Supply together with `onOpenChange`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
  className?: string
}

export function DisclosurePanel({
  title,
  hint,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: DisclosurePanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : uncontrolledOpen
  const id = useId()

  function toggle() {
    const next = !open
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section className={cn('rounded-lg border border-line bg-surface-strong', className)}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="flex w-full items-center gap-2 px-[21px] py-3.5 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          {hint && <span className="hint ml-auto">{hint}</span>}
        </button>
      </h3>
      <div id={id} hidden={!open} className="px-[21px] pb-[18px]">
        {children}
      </div>
    </section>
  )
}

export default DisclosurePanel
