'use client'

import { cn } from '@/lib/utils'

/**
 * Every numeric quantity in the product renders through this primitive.
 *
 * The rule it enforces: a number and its unit are never one string. The value
 * carries the monospace, tabular-nums styling so decimal separators align down
 * a column; the unit sits in a sibling element, smaller and muted, so it does
 * not inherit the tabular width and does not pad the number.
 *
 * Uncertainty is first class too. A measured quantity without its sigma is a
 * claim the engine cannot make, so `sigma` renders inline rather than being
 * left to each caller to format.
 *
 * Covers design-system-foundation R6.
 */
export interface NumProps {
  /** The quantity. `null` and non-finite values render as an em dash. */
  value: number | string | null | undefined
  /** Unit symbol, rendered as a sibling. Never concatenate it into `value`. */
  unit?: string
  /** Decimal places. Ignored when `value` is already a string. */
  digits?: number
  /** Standard deviation, rendered as `± sigma` in the same precision. */
  sigma?: number | null
  className?: string
  /** Larger presentation for metric cards. */
  size?: 'sm' | 'md' | 'lg'
}

const SIZES: Record<string, string> = {
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-[29px] tracking-[-0.045em] leading-none',
}

function format(value: number | string | null | undefined, digits: number): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(Math.min(digits, 2))
  return value.toFixed(digits)
}

export function Num({ value, unit, digits = 2, sigma, className, size = 'md' }: NumProps) {
  const text = format(value, digits)
  const hasSigma = sigma !== null && sigma !== undefined && Number.isFinite(sigma)

  return (
    <span className={cn('inline-flex items-baseline gap-[0.28em]', className)}>
      <span className={cn('num text-ink', SIZES[size])}>{text}</span>
      {hasSigma && (
        <span className="num text-[0.72em] text-ink-muted" aria-label="standard deviation">
          ±{format(sigma as number, digits)}
        </span>
      )}
      {unit && <span className="num-unit">{unit}</span>}
    </span>
  )
}

export default Num
