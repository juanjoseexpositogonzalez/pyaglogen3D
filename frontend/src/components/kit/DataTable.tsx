'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Num } from './Num'

/**
 * The product's table: 12px rows, tiny uppercase sticky headers, hairline
 * separators, no zebra striping, numeric columns right-aligned and tabular.
 *
 * Built directly here rather than on a shadcn `ui/table`, which this
 * repository does not have: shadcn is installed only partially and without a
 * `components.json` to generate one, and creating a file under `ui/` falls
 * outside this change's editable surface.
 */
export interface Column<T> {
  key: string
  header: ReactNode
  /** Right-aligned and rendered through `Num` when true. */
  numeric?: boolean
  unit?: string
  digits?: number
  /** Overrides the default rendering for this cell. */
  render?: (row: T) => ReactNode
  /** Reads the raw value when no `render` is given. */
  value?: (row: T) => number | string | null
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  caption?: string
  /** Enables the sticky header and vertical scrolling. */
  maxHeight?: number
  /** Row key; falls back to the index. */
  rowKey?: (row: T, index: number) => string
  emptyMessage?: ReactNode
  className?: string
}

export function DataTable<T>({
  columns,
  rows,
  caption,
  maxHeight,
  rowKey,
  emptyMessage = 'No data.',
  className,
}: DataTableProps<T>) {

  return (
    <div
      className={cn('overflow-x-auto', maxHeight && 'overflow-y-auto', className)}
      style={maxHeight ? { maxHeight, scrollbarGutter: 'stable' } : undefined}
      // A scrolling box with no focusable content cannot be reached by
      // keyboard, so every row below the fold would be unreachable. R7-S2
      // requires the opposite.
      tabIndex={maxHeight ? 0 : undefined}
      role={maxHeight ? 'region' : undefined}
      aria-label={maxHeight ? (caption ?? 'Data table') : undefined}
    >
      <table className="w-full border-collapse text-[12px]">
        {caption && <caption className="hint pb-2 text-left">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap border-b border-line-strong bg-surface-strong px-3 py-2.5',
                  'text-[10px] uppercase tracking-[0.05em] text-ink-muted',
                  maxHeight && 'sticky top-0 z-10',
                  c.numeric ? 'text-right' : 'text-left',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="hint border-b-0 px-3 py-3.5 text-center"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i} className="hover:bg-[var(--row-hover)]">
              {columns.map((c) => {
                const raw = c.value ? c.value(row) : null
                return (
                  <td
                    key={c.key}
                    className={cn(
                      'border-b border-line px-3 py-3 align-top text-ink',
                      c.numeric && 'text-right',
                    )}
                  >
                    {c.render ? (
                      c.render(row)
                    ) : c.numeric ? (
                      <Num
                        value={raw as number | null}
                        unit={c.unit}
                        digits={c.digits}
                        size="sm"
                      />
                    ) : (
                      (raw as ReactNode)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default DataTable
