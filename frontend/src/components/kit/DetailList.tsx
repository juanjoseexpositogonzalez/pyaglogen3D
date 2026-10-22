'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Num } from './Num'

/**
 * Label left, value right, one row per entry, hairline separators.
 *
 * Used for every parameter recap in the product. When an entry carries a
 * numeric `value`, it renders through `Num` so the unit stays a sibling and
 * the column aligns; a `ReactNode` value is rendered as given.
 */
export interface DetailItem {
  label: ReactNode
  value: ReactNode | number | null
  unit?: string
  digits?: number
  sigma?: number | null
  /** Where the value came from, when it was not entered here. */
  provenance?: string
}

export interface DetailListProps {
  items: DetailItem[]
  className?: string
}

export function DetailList({ items, className }: DetailListProps) {
  return (
    <dl className={cn('grid gap-0', className)}>
      {items.map((item, i) => {
        const numeric = typeof item.value === 'number' || item.value === null
        return (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-[12px] last:border-b-0"
          >
            <dt className="text-ink-muted">
              {item.label}
              {item.provenance && (
                <span className="hint ml-1.5" title={item.provenance}>
                  ({item.provenance})
                </span>
              )}
            </dt>
            <dd className="m-0 text-right font-semibold text-ink">
              {numeric ? (
                <Num
                  value={item.value as number | null}
                  unit={item.unit}
                  digits={item.digits}
                  sigma={item.sigma}
                  size="sm"
                />
              ) : (
                (item.value as ReactNode)
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export default DetailList
