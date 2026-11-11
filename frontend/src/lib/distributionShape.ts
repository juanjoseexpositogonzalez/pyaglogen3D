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
 * The cap and the capped magnitudes are mirrored from the backend, which stays
 * the authority: `distributionShape.STD_OVER_MEAN_CAP` and `CAPPED_MAGNITUDE`.
 * A drift test reads them from the Python module so the two cannot separate -
 * before #201 this mirror was narrower, and a `{mean: 1, std: 0.5}` on the
 * primary size reached the server with a 400 and no border on the field.
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
  // The backend's `_positive` applies to `max` too, so the mirror does as well.
  max: "'max' must be greater than 0",
} satisfies Record<'value' | 'mean' | 'std' | 'min' | 'max', string>

/** Mirrored from `distribution_shape.STD_OVER_MEAN_CAP`; a drift test pins it. */
export const STD_OVER_MEAN_CAP = 0.3

/** Mirrored from `distribution_shape.CAPPED_MAGNITUDE`; a drift test pins it. */
export const CAPPED_MAGNITUDES = ['particle_radius_config', 'dpo_distribution'] as const

function requirePositive(
  field: keyof typeof POSITIVE,
  raw: number | null,
): DistributionValueError | null {
  // `null` is an empty box, not a zero (#243). Reporting "'value' must be greater
  // than 0" for a field the reader just cleared blames them for a number nobody
  // typed, so the message names the condition that is actually true.
  if (raw === null) return { field, message: `'${field}' is required` }
  // `NaN <= 0` is false and `Infinity` is positive, so the old check let both
  // through and then said they "must be greater than 0", which is not the
  // problem: the backend says "must be a finite number" and so does this now.
  if (!Number.isFinite(raw)) {
    return { field, message: `'${field}' must be a finite number` }
  }
  if (raw > 0) return null
  return { field, message: POSITIVE[field] }
}

/**
 * The first entry of a grid that breaks a rule, or `null`.
 *
 * The selector marks a field when it is left, and that is all it does: nothing in
 * either form refused a submit on it, so an emptied box travelled as `null` — or, in
 * the batch grid, was filtered out and silently shortened what the study sweeps
 * (#243, found in review). This is the gate the forms were missing.
 */
export function firstDistributionError(
  values: DistributionValue[],
  parameterName?: string,
): { index: number; error: DistributionValueError } | null {
  for (let index = 0; index < values.length; index++) {
    const error = distributionValueError(values[index], parameterName)
    if (error) return { index, error }
  }
  return null
}

function isCapped(parameterName: string | undefined): boolean {
  return (
    parameterName !== undefined &&
    (CAPPED_MAGNITUDES as readonly string[]).includes(parameterName)
  )
}

export function distributionValueError(
  value: DistributionValue,
  parameterName?: string,
): DistributionValueError | null {
  if (value.mode === 'fixed') return requirePositive('value', value.value)

  if (value.mode === 'normal') {
    const broken =
      requirePositive('mean', value.mean) ?? requirePositive('std', value.std)
    if (broken) return broken
    // Both are numbers from here: `requirePositive` refused the nulls above.
    const mean = value.mean
    const std = value.std
    if (mean === null || std === null) return null
    // R2's cap, and it follows the magnitude rather than the value: the same
    // spread is refused for the primary size and accepted for the prefactor.
    if (isCapped(parameterName)) {
      const ratio = std / mean
      if (ratio > STD_OVER_MEAN_CAP) {
        return {
          field: 'std',
          message:
            `std/mean ratio (${ratio.toFixed(4)}) exceeds cap ` +
            `(${STD_OVER_MEAN_CAP})`,
        }
      }
    }
    return null
  }

  const low = requirePositive('min', value.min)
  if (low) return low
  const finiteMax = requirePositive('max', value.max)
  if (finiteMax) return finiteMax
  const min = value.min
  const max = value.max
  if (min === null || max === null) return null
  if (max > min) return null
  return { field: 'max', message: "'max' must be greater than 'min'" }
}
