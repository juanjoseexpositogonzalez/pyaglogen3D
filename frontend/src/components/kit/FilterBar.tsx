'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The row of controls above a table or a card grid.
 *
 * The right-aligned hint carries the result count. A filtered surface that does
 * not say how much it is hiding invites the reader to mistake a filter for an
 * empty dataset.
 */
export interface FilterBarProps {
  children: ReactNode
  /** Result count or scope note, right-aligned, e.g. `18 of 96 images`. */
  hint?: ReactNode
  className?: string
}

export function FilterBar({ children, hint, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        'mb-[18px] flex flex-wrap items-end gap-2.5 rounded-md border border-line bg-surface-soft p-2.5',
        className,
      )}
    >
      {children}
      {hint && <span className="hint ml-auto self-center px-2">{hint}</span>}
    </div>
  )
}

/** A labelled control inside the bar; the label is tiny, tracked and uppercase. */
export interface FilterFieldProps {
  label: string
  children: ReactNode
  className?: string
}

export function FilterField({ label, children, className }: FilterFieldProps) {
  return (
    <label className={cn('grid gap-1.5', className)}>
      <span className="label-xs pl-0.5">{label}</span>
      {children}
    </label>
  )
}

export default FilterBar
