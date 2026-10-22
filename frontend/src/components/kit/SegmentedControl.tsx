'use client'

import { cn } from '@/lib/utils'

/**
 * A view switch: estimator, scaling, grid mode, theme.
 *
 * Implemented as a radio group rather than buttons, so a keyboard user moves
 * between options with the arrow keys and assistive technology announces which
 * one is active. The selected option is marked by background and weight as
 * well as colour.
 */
export interface SegmentedOption<V extends string> {
  value: V
  label: string
}

export interface SegmentedControlProps<V extends string> {
  options: SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Required: a radio group without a name is unannounced. */
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-soft p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-sm transition-colors',
              size === 'sm' ? 'px-2 py-1 text-[10.5px]' : 'px-2.5 py-1.5 text-[11.5px]',
              'font-bold',
              selected
                ? 'bg-surface-strong text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
