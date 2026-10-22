'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { DataTable, type Column } from './DataTable'

/**
 * The text alternative every chart and spatial view owes its reader.
 *
 * It is an accessibility requirement, and for a scientific tool it is also a
 * plain usability one: researchers want the numbers, and these plots end up
 * printed in greyscale for a paper. The toggle swaps the visual for the data
 * behind it in place, keeping the panel chrome, so nothing moves on screen
 * except the thing being inspected.
 *
 * Covers design-system-foundation R7.
 */
export interface ShowValuesButtonProps {
  shown: boolean
  onToggle: () => void
  className?: string
}

export function ShowValuesButton({ shown, onToggle, className }: ShowValuesButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={shown}
      onClick={onToggle}
      className={cn(
        'rounded-sm px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em]',
        'text-ink-muted transition-colors hover:bg-accent hover:text-ink',
        className,
      )}
    >
      {shown ? 'Show chart' : 'Show values'}
    </button>
  )
}

export interface ShowValuesProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Caption for the table, describing what the visual showed. */
  caption?: string
  maxHeight?: number
  children: ReactNode
  /** Render prop for the panel header, so the toggle sits with the title. */
  renderHeader?: (toggle: ReactNode) => ReactNode
}

export function ShowValues<T>({
  columns,
  rows,
  caption,
  maxHeight = 340,
  children,
  renderHeader,
}: ShowValuesProps<T>) {
  const [shown, setShown] = useState(false)
  const toggle = <ShowValuesButton shown={shown} onToggle={() => setShown(!shown)} />

  return (
    <>
      {renderHeader ? (
        renderHeader(toggle)
      ) : (
        <div className="mb-2.5 flex justify-end">{toggle}</div>
      )}
      {shown ? (
        <DataTable columns={columns} rows={rows} caption={caption} maxHeight={maxHeight} />
      ) : (
        children
      )}
    </>
  )
}

export default ShowValues
