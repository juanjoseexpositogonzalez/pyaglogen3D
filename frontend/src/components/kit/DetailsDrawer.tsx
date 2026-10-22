'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A right-side drawer for inspecting one row, particle, node or image.
 *
 * A drawer rather than a modal on purpose: inspecting a detail should not hide
 * the table it came from, so the reader keeps their place in the data. That is
 * why this builds on the Radix primitive with `modal={false}` and no overlay,
 * instead of on `ui/dialog`'s `DialogContent`, which always mounts a
 * `DialogOverlay` at 80% black and traps the page behind it.
 *
 * No entry animation classes: `tailwindcss-animate` is not installed in this
 * repository, so `slide-in-from-right` and friends emit no CSS. Claiming an
 * animation that never runs is worse than having none.
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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={cn(
            'fixed right-0 top-0 z-50 flex h-full w-[min(440px,100%)] flex-col',
            'overflow-y-auto border-l border-line bg-surface-strong p-6 shadow-deep',
            'focus:outline-none',
            className,
          )}
          // The point of a non-modal drawer is that the table behind it stays
          // readable; closing on outside interaction would undo that.
          onInteractOutside={(event) => event.preventDefault()}
        >
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="m-0 text-[16px] font-semibold tracking-[-0.015em] text-ink">
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description className="mt-1 text-[12px] text-ink-muted">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close details"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-ink-muted transition-colors hover:bg-accent hover:text-ink"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="mt-5 grid gap-5">{children}</div>

          {footer && <div className="mt-auto border-t border-line pt-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export default DetailsDrawer
