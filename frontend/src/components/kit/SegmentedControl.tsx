'use client'

import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

import { cn } from '@/lib/utils'

/**
 * A view switch: estimator, scaling, grid mode, theme.
 *
 * Implemented as a radio group, which means the arrow-key behaviour and the
 * roving tabindex have to be provided here: `role="radiogroup"` replaces the
 * native semantics rather than adding to them, so the browser contributes
 * nothing. Arrow keys and Home/End move selection and focus together, and only
 * the selected option sits in the tab order, so the control costs one tab stop
 * instead of one per option.
 *
 * The selected option is marked by background and weight as well as colour.
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
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function move(from: number, delta: number) {
    if (options.length === 0) return
    const next = (from + delta + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        move(index, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        move(index, -1)
        break
      case 'Home':
        event.preventDefault()
        move(-1, 1)
        break
      case 'End':
        event.preventDefault()
        move(0, -1)
        break
      default:
        break
    }
  }

  const selectedIndex = options.findIndex((o) => o.value === value)

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-soft p-0.5',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: one stop for the whole group. When nothing is
            // selected yet, the first option keeps the group reachable.
            tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
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
