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

interface MetricCardBase {
  label: ReactNode
  value: number | null
  unit?: string
  digits?: number
  delta?: MetricDelta
  /** 0 to 1; renders the thin progress rail under the value. */
  progress?: number
  tone?: Tone
  className?: string
}

/**
 * A quantity the engine measured or estimated. `sigma` and `detail` are
 * required: a fractal dimension without its uncertainty and without the
 * estimator that produced it is a number without a claim, and leaving both
 * optional let a caller render one by omission.
 */
export interface MeasuredMetric extends MetricCardBase {
  kind: 'measured'
  sigma: number | null
  /** Estimator, fit quality and sample size, e.g. `R² 0.994 · box counting`. */
  detail: ReactNode
}

/**
 * A quantity that is exact by construction: a particle count, a seed, a
 * requested target. No uncertainty exists, so none is demanded.
 */
export interface ExactMetric extends MetricCardBase {
  kind: 'exact'
  detail?: ReactNode
}

export type MetricCardProps = MeasuredMetric | ExactMetric

const DELTA_INK: Record<MetricDelta['quality'], string> = {
  good: 'text-success',
  poor: 'text-warning',
  neutral: 'text-ink-muted',
}

export function MetricCard(props: MetricCardProps) {
  const {
    label,
    value,
    unit,
    digits = 3,
    delta,
    progress,
    tone = 'plain',
    className,
    detail,
  } = props
  const sigma = props.kind === 'measured' ? props.sigma : null
  // Clamped once and used for both the width and the announced value: an
  // unclamped aria-valuenow of 140 against aria-valuemax 100, or NaN from a
  // ratio with a zero denominator, is worse than no progress bar at all.
  const ratio =
    progress !== undefined && Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress))
      : undefined
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

      {ratio !== undefined && (
        <div
          className="my-2.5 h-1.5 overflow-hidden rounded-full bg-line-strong"
          role="progressbar"
          aria-label={typeof label === 'string' ? `${label} progress` : 'Progress'}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand-strong transition-[width] duration-200"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}

      {detail && <p className="m-0 text-[11px] text-ink-muted">{detail}</p>}
    </article>
  )
}

export default MetricCard
