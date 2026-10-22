'use client'

import type { ReactNode } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * A right-side drawer for inspecting one row, particle, node or image.
 *
 * A drawer rather than a modal on purpose: inspecting a detail should not hide
 * the table it came from, so the reader keeps their place in the data.
 *
 * Built on `ui/dialog`, which this repository does have, so focus trapping,
 * escape handling and the overlay come from the primitive already in use
 * rather than from a second implementation.
 */
export interface DetailsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** One line of identity under the title, e.g. coordination and neighbours. */
  subtitle?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

export function DetailsDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  footer,
  children,
  className,
}: DetailsDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'left-auto right-0 top-0 h-full w-[min(440px,100%)] max-w-none translate-x-0 translate-y-0',
          'overflow-y-auto rounded-none border-l border-line bg-surface-strong p-6',
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          className,
        )}
      >
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-[16px] font-semibold tracking-[-0.015em] text-ink">
            {title}
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="text-[12px] text-ink-muted">{subtitle}</DialogDescription>
          )}
        </DialogHeader>

        <div className="mt-5 grid gap-5">{children}</div>

        {footer && <div className="mt-6 border-t border-line pt-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}

export default DetailsDrawer
