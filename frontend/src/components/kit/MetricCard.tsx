'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Num } from './Num'
import type { Tone } from './Panel'

/**
 * The headline figure of a screen: a tiny tracked label, a large tightly
 * tracked number, and a line of detail that says how it was obtained.
 *
 * `detail` is not decoration. A fractal dimension without its fit quality is a
 * number without a claim, so the card expects to be told `R² 0.994 · box
 * counting, 8 octaves` rather than left bare.
 *
 * `delta` compares against a target and states the direction in words as well
 * as colour, because status is never colour alone.
 */
const TONE_BG: Record<Tone, string> = {
  plain: 'bg-surface-strong',
  teal: 'bg-panel-teal',
  violet: 'bg-panel-violet',
  gold: 'bg-panel-gold',
  navy: 'bg-panel-navy',
  slate: 'bg-panel-slate',
}

export interface MetricDelta {
  /** Rendered verbatim, e.g. `-0.167 vs target`. */
  text: string
  /** `good` and `poor` tint it; both always carry the text too. */
  quality: 'good' | 'poor' | 'neutral'
}

export interface MetricCardProps {
  label: ReactNode
  value: number | string | null
  unit?: string
  digits?: number
  sigma?: number | null
  /** How the value was obtained: estimator, fit quality, sample size. */
  detail?: ReactNode
  delta?: MetricDelta
  /** 0 to 1; renders the thin progress rail under the value. */
  progress?: number
  tone?: Tone
  className?: string
}

const DELTA_INK: Record<MetricDelta['quality'], string> = {
  good: 'text-success',
  poor: 'text-warning',
  neutral: 'text-ink-muted',
}

export function MetricCard({
  label,
  value,
  unit,
  digits = 3,
  sigma,
  detail,
  delta,
  progress,
  tone = 'plain',
  className,
}: MetricCardProps) {
  return (
    <article
      className={cn(
        'min-h-[130px] rounded-lg border border-line p-[17px_18px] shadow-panel',
        TONE_BG[tone],
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-ink-muted">{label}</span>
        {delta && (
          <span className={cn('text-[10px] font-extrabold', DELTA_INK[delta.quality])}>
            {delta.text}
          </span>
        )}
      </header>

      <div className="mb-1.5 mt-[15px]">
        <Num value={value} unit={unit} digits={digits} sigma={sigma} size="lg" />
      </div>

      {progress !== undefined && (
        <div
          className="my-2.5 h-1.5 overflow-hidden rounded-full bg-line-strong"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand-strong transition-[width] duration-200"
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        </div>
      )}

      {detail && <p className="m-0 text-[11px] text-ink-muted">{detail}</p>}
    </article>
  )
}

export default MetricCard
