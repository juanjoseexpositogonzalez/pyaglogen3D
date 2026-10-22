'use client'

import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A collapsible section, for advanced parameters and for recaps that should be
 * available without competing for attention.
 *
 * Built on native button plus `aria-expanded` and `aria-controls` rather than
 * `<details>`, so the open state can be driven from outside — the parameter
 * recap on a result page opens when a validation error points into it.
 */
export interface DisclosurePanelProps {
  title: ReactNode
  hint?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

export function DisclosurePanel({
  title,
  hint,
  defaultOpen = false,
  children,
  className,
}: DisclosurePanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <section className={cn('rounded-lg border border-line bg-surface-strong', className)}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
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
