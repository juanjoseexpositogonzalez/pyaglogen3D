'use client'

import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A monospace value with a copy affordance.
 *
 * Reproducibility is visible in this product: the seed that produced an
 * aggregate sits next to its algorithm and is one click from the clipboard, so
 * a result can always be regenerated.
 */
export interface CopyTextProps {
  /** Short label rendered before the value, e.g. `Seed`. */
  label?: string
  value: string | number
  className?: string
}

export function CopyText({ label, value, className }: CopyTextProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const text = String(value)

  // Without this, unmounting the row inside the 1.6s window leaves a setState
  // on an unmounted component, and repeated clicks stack timers so the first
  // one resets the icon while the second is still running.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // A denied clipboard permission is not worth interrupting the user for;
      // the value stays selectable on screen.
      setCopied(false)
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px]', className)}>
      {label && <span className="text-ink-muted">{label}</span>}
      <span className="num text-ink">{text}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${text} copied` : `Copy ${label ?? 'value'} ${text}`}
        className="inline-grid h-5 w-5 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-accent hover:text-ink"
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </button>
      {/* Announced to assistive technology without moving focus. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </span>
  )
}

export default CopyText
