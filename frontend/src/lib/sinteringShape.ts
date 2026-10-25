import type { DistributionValue, SimulationAlgorithm } from './types'

/**
 * The sintering domain shape the API speaks (R3 of
 * `batch-cc-tunable-parameter-parity`).
 *
 * It is not the generic distribution shape: the fixed variant uses
 * `coefficient`, not `value`, and there is no `mode` key anywhere.
 */
export type SinteringConfig =
  | { distribution_type: 'fixed'; coefficient: number }
  | { distribution_type: 'normal'; mean: number; std: number }
  | { distribution_type: 'uniform'; min: number; max: number }

/**
 * Translate the selector's vocabulary into the API's, in one place.
 *
 * Sending `{mode, …}` is defect D2 of this contract: the backend used to
 * accept it and silently run the child at 1.0 — no sintering at all — while
 * the stored parameters claimed otherwise. Since T1 it answers 400 instead,
 * which is honest but still a request the form should never make.
 */
export function toSinteringConfig(value: DistributionValue): SinteringConfig {
  switch (value.mode) {
    case 'fixed':
      return { distribution_type: 'fixed', coefficient: value.value }
    case 'normal':
      return { distribution_type: 'normal', mean: value.mean, std: value.std }
    case 'uniform':
      return { distribution_type: 'uniform', min: value.min, max: value.max }
  }
}

/**
 * The algorithms whose engine invocation receives sintering parameters (R11).
 *
 * `limiting` is deliberately absent: it reads `sintering_coeff` and ignores
 * type, min, max and std, so it gets its own flat sweep in the form rather
 * than the distribution option.
 */
export const SINTERING_ALGORITHMS: readonly SimulationAlgorithm[] = [
  'dla',
  'cca',
  'ballistic',
  'ballistic_cc',
  'tunable',
  'tunable_cc',
] as const

export function consumesSintering(algorithm: SimulationAlgorithm): boolean {
  return SINTERING_ALGORITHMS.includes(algorithm)
}

/** The variation names that carry a sintering setting into the payload. */
const SINTERING_VARIATIONS = new Set(['sintering_config', 'sintering_coeff'])

/**
 * Does `algorithm` reject this configured variation?
 *
 * The authority is R11 — what the backend refuses — not which options the
 * dropdown happens to list. Clearing by the dropdown deleted variations the
 * server accepts: a flat `sintering_coeff` survives a move from `limiting` to
 * `ballistic`, and `sticking_probability` is accepted by `tunable` even though
 * neither is offered there. Deleting those is data loss, and saying "X does not
 * accept it" about them is false.
 */
export function rejectsVariation(
  algorithm: SimulationAlgorithm,
  name: string,
  values: DistributionValue[] = [],
): boolean {
  if (!SINTERING_VARIATIONS.has(name)) return false

  // `limiting` reads the coefficient and ignores type, min, max and std, so it
  // takes the fixed shape only (R11.5).
  if (algorithm === 'limiting') {
    return values.some((v) => v.mode !== 'fixed')
  }

  return !consumesSintering(algorithm)
}

