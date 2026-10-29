import { describe, it, expect } from 'vitest'
import { toSinteringConfig } from '../sinteringShape'
import type { DistributionValue } from '../types'

// ---------------------------------------------------------------------------
// T6.1 / R10.5 — the selector's shape is not the API's shape
//
// The selector speaks `{mode, …}`; R3 speaks
// `{distribution_type, coefficient | mean+std | min+max}`. Sending the first
// one is defect D2 of this contract: the backend used to accept `{mode:…}` and
// silently run the child at 1.0, i.e. with no sintering at all. The
// translation lives in one pure function so there is a single place where the
// two vocabularies meet.
// ---------------------------------------------------------------------------

describe('toSinteringConfig', () => {
  it('maps fixed to coefficient, the key R3 names', () => {
    const value: DistributionValue = { mode: 'fixed', value: 0.9 }

    expect(toSinteringConfig(value)).toEqual({
      distribution_type: 'fixed',
      coefficient: 0.9,
    })
  })

  it('maps normal to mean and std', () => {
    const value: DistributionValue = { mode: 'normal', mean: 0.8, std: 0.05 }

    expect(toSinteringConfig(value)).toEqual({
      distribution_type: 'normal',
      mean: 0.8,
      std: 0.05,
    })
  })

  it('maps uniform to min and max', () => {
    const value: DistributionValue = { mode: 'uniform', min: 0.7, max: 0.95 }

    expect(toSinteringConfig(value)).toEqual({
      distribution_type: 'uniform',
      min: 0.7,
      max: 0.95,
    })
  })

  it('never carries the selector key through', () => {
    for (const value of [
      { mode: 'fixed', value: 0.9 },
      { mode: 'normal', mean: 0.8, std: 0.05 },
      { mode: 'uniform', min: 0.7, max: 0.95 },
    ] as DistributionValue[]) {
      expect(Object.keys(toSinteringConfig(value))).not.toContain('mode')
    }
  })

  it('translates what the selector produces with no edit at all', () => {
    // The grid's default entry, and what switching mode yields on top of it:
    // uniform gives `min === max === base`, normal gives `std = 0.1 * mean`.
    // R3 accepts 0.5..1.0 for coefficients and 0 < std <= 0.2, so all three
    // are submittable without the user touching a number.
    expect(toSinteringConfig({ mode: 'fixed', value: 1.0 })).toEqual({
      distribution_type: 'fixed',
      coefficient: 1.0,
    })
    expect(toSinteringConfig({ mode: 'uniform', min: 1.0, max: 1.0 })).toEqual({
      distribution_type: 'uniform',
      min: 1.0,
      max: 1.0,
    })
    expect(toSinteringConfig({ mode: 'normal', mean: 1.0, std: 0.1 })).toEqual({
      distribution_type: 'normal',
      mean: 1.0,
      std: 0.1,
    })
  })
})
