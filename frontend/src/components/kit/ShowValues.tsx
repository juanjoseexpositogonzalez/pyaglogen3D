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

/**
 * The two pieces the primitive resolves, handed to a caller that owns the
 * layout. `table` is null while the visual is the thing on screen: an empty
 * table is not a substitute for "there is nothing to show yet".
 */
export interface ShowValuesParts {
  /** The control, already wired to this primitive's state. */
  toggle: ReactNode
  /** The table of the data behind the visual, or null while it is hidden. */
  table: ReactNode | null
}

export interface ShowValuesProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Caption for the table, describing what the visual showed. */
  caption?: string
  maxHeight?: number
  /**
   * The visual, or a render prop that places the parts itself.
   *
   * A node keeps the historical layout: the toggle above, the visual or the
   * table below. A function is for callers that own a boxed stage — a panel
   * that should keep its title, its caption bar and its frame while the table
   * takes the visual's place. Those callers cannot get that from the node form,
   * because the header and the body are rendered as siblings and the table
   * would land outside their frame.
   */
  children: ReactNode | ((parts: ShowValuesParts) => ReactNode)
  /**
   * Render prop for the panel header, so the toggle sits with the title.
   * Ignored when `children` is a function: the caller places the toggle itself.
   */
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
  const table: ReactNode | null = shown ? (
    <DataTable columns={columns} rows={rows} caption={caption} maxHeight={maxHeight} />
  ) : null

  if (typeof children === 'function') {
    // Nothing is rendered around the caller's composition: it places both
    // parts, so any chrome added here would duplicate its header.
    return <>{children({ toggle, table })}</>
  }

  return (
    <>
      {renderHeader ? (
        renderHeader(toggle)
      ) : (
        <div className="mb-2.5 flex justify-end">{toggle}</div>
      )}
      {shown ? table : children}
    </>
  )
}

export default ShowValues
