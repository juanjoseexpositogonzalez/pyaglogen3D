import type { DistributionValue } from '@/lib/types'

/**
 * The first rule a distribution value breaks, named by the field that breaks it.
 *
 * R8.4 asks for a border and a message **on that field** when it loses focus, so
 * the caller needs to know which input to mark, not just that something is
 * wrong. The backend stays the authority, and this exists so the user learns
 * before submitting — the batch page does not display submit errors (issue #115,
 * point 6).
 *
 * What this does NOT cover, and the comment used to claim it did: R2's
 * `std/mean <= 0.3` cap, which depends on the magnitude being edited and not on
 * the value alone, so a `{mean: 1, std: 0.5}` on the primary size still reaches
 * the server before anyone says anything. Tracked in #201.
 *
 * `DistributionValue` is a discriminated union, so every field is reached
 * through its own arm and no cast is needed.
 */

export interface DistributionValueError {
  field: 'value' | 'mean' | 'std' | 'min' | 'max'
  message: string
}

const POSITIVE = {
  value: "'value' must be greater than 0",
  mean: "'mean' must be greater than 0",
  std: "'std' must be greater than 0",
  min: "'min' must be greater than 0",
} satisfies Record<'value' | 'mean' | 'std' | 'min', string>

function requirePositive(
  field: keyof typeof POSITIVE,
  raw: number,
): DistributionValueError | null {
  if (Number.isFinite(raw) && raw > 0) return null
  return { field, message: POSITIVE[field] }
}

export function distributionValueError(
  value: DistributionValue,
): DistributionValueError | null {
  if (value.mode === 'fixed') return requirePositive('value', value.value)

  if (value.mode === 'normal') {
    return requirePositive('mean', value.mean) ?? requirePositive('std', value.std)
  }

  const low = requirePositive('min', value.min)
  if (low) return low
  if (value.max > value.min) return null
  return { field: 'max', message: "'max' must be greater than 'min'" }
}
