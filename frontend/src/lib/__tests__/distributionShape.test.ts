import { describe, it, expect } from 'vitest'
import {
  CAPPED_MAGNITUDES,
  STD_OVER_MEAN_CAP,
  distributionValueError,
} from '../distributionShape'

// ---------------------------------------------------------------------------
// #201 — the client was narrower than the backend in two ways the reviews
// measured: it never applied R2's std/mean cap, and it never looked at `max`
// beyond `max > min`, so an infinite bound passed the field and came back as a
// 400 with no border on it (R8.4).
// ---------------------------------------------------------------------------

describe('the std/mean cap follows the magnitude', () => {
  it('refuses a spread past the cap on a capped magnitude', () => {
    const error = distributionValueError(
      { mode: 'normal', mean: 1.0, std: 0.5 },
      'particle_radius_config',
    )

    expect(error).not.toBeNull()
    expect(error?.field).toBe('std')
    expect(error?.message).toContain('std/mean')
    expect(error?.message).toContain(String(STD_OVER_MEAN_CAP))
  })

  it('accepts exactly the cap, because R2 says <=', () => {
    expect(
      distributionValueError(
        { mode: 'normal', mean: 1.0, std: STD_OVER_MEAN_CAP },
        'particle_radius_config',
      ),
    ).toBeNull()
  })

  it('does not cap the fractal prefactor', () => {
    expect(
      distributionValueError(
        { mode: 'normal', mean: 1.0, std: 0.5 },
        'kf_distribution',
      ),
    ).toBeNull()
  })

  it('knows every magnitude the backend caps', () => {
    expect([...CAPPED_MAGNITUDES].sort()).toEqual([
      'dpo_distribution',
      'particle_radius_config',
    ])
  })
})

describe('a bound has to be finite', () => {
  it('names the field when max is infinite', () => {
    const error = distributionValueError(
      { mode: 'uniform', min: 1.0, max: Number.POSITIVE_INFINITY },
      'particle_radius_config',
    )

    expect(error?.field).toBe('max')
    expect(error?.message).toContain('finite')
  })

  it('does not blame the ordering when max is not a number', () => {
    const error = distributionValueError(
      { mode: 'uniform', min: 1.0, max: Number.NaN },
      'particle_radius_config',
    )

    expect(error?.message).not.toContain('greater than')
    expect(error?.message).toContain('finite')
  })

  it('still accepts a normal finite range', () => {
    expect(
      distributionValueError({ mode: 'uniform', min: 1.0, max: 2.0 }, 'kf_distribution'),
    ).toBeNull()
  })
})
