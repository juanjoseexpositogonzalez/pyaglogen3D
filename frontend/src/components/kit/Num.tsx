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
  /**
   * The quantity. `null` and non-finite values render as an em dash.
   *
   * Deliberately not a string: accepting one let a caller pass `'68.4 nm'`
   * and defeat the very rule this primitive exists to impose. Confidence
   * intervals and other composite readings use `NumRange` below.
   */
  value: number | null | undefined
  /** Unit symbol, rendered as a sibling. Never concatenate it into `value`. */
  unit?: string
  /** Decimal places. Clamped to 0..20; toFixed throws outside that range. */
  digits?: number
  /** Standard deviation, rendered as `± sigma` in the same precision. */
  sigma?: number | null
  className?: string
  /** Larger presentation for metric cards. */
  size?: 'sm' | 'md' | 'lg'
}

const SIZES: Record<NonNullable<NumProps['size']>, string> = {
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-[29px] tracking-[-0.045em] leading-none',
}

function format(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // toFixed throws a RangeError outside 0..100, and `digits` reaches here from
  // column definitions that nothing validates.
  const safe = Math.max(0, Math.min(20, Math.trunc(digits)))
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(Math.min(safe, 2))
  return value.toFixed(safe)
}

export function Num({ value, unit, digits = 2, sigma, className, size = 'md' }: NumProps) {
  const text = format(value, digits)
  const hasSigma = sigma !== null && sigma !== undefined && Number.isFinite(sigma)
  // Without a magnitude there is nothing for a unit to qualify.
  const showUnit = Boolean(unit) && value !== null && value !== undefined && Number.isFinite(value)

  return (
    <span className={cn('inline-flex items-baseline gap-[0.28em]', className)}>
      <span className={cn('num text-ink', SIZES[size])}>{text}</span>
      {hasSigma && (
        <span className="num text-[0.72em] text-ink-muted" aria-label="standard deviation">
          ±{format(sigma as number, digits)}
        </span>
      )}
      {showUnit && <span className="num-unit">{unit}</span>}
    </span>
  )
}

/**
 * A composite reading such as a confidence interval, where the bracket and the
 * separator are part of the value. Kept apart from `Num` so that the plain
 * numeric path cannot be used to smuggle a unit into the number.
 */
export interface NumRangeProps {
  from: number | null
  to: number | null
  unit?: string
  digits?: number
  className?: string
}

export function NumRange({ from, to, unit, digits = 2, className }: NumRangeProps) {
  return (
    <span className={cn('inline-flex items-baseline gap-[0.28em]', className)}>
      <span className="num text-[13px] text-ink">
        [{format(from, digits)}, {format(to, digits)}]
      </span>
      {unit && <span className="num-unit">{unit}</span>}
    </span>
  )
}

export default Num
