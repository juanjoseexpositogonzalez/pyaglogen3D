/**
 * #341 — the sentence names a change, not a suggestion.
 *
 * Since #341 the gate is the whole decision: above it the form *sets* the seed
 * type, so a sentence that said "recommended" would describe a choice the reader
 * no longer has. It stays a sentence with numbers, because a warning that lost
 * them would say "dimers" and nothing a reader could check.
 */
import { describe, expect, it } from 'vitest'

import {
  DIMERS_ADVICE,
  DIMERS_HELD,
  HIGH_DF_KF_FLOOR,
  HIGH_DF_NEEDS_DIMERS,
  needsDimers,
} from '../seedTypeAdvice'

describe('DIMERS_ADVICE (#341)', () => {
  it('says the selection was changed, not that it is recommended', () => {
    expect(DIMERS_ADVICE).toMatch(/changed/i)
    expect(DIMERS_ADVICE).not.toMatch(/recommend/i)
  })

  it('keeps the measured numbers', () => {
    // The measurement L5 locked: monomers 2.37 against dimers 2.77–2.80 for a
    // 2.7 target, at N=100 and N=1000. A sentence without them is noise.
    expect(DIMERS_ADVICE).toMatch(/2\.37/)
    expect(DIMERS_ADVICE).toMatch(/2\.77/)
    expect(DIMERS_ADVICE).toMatch(/2\.80/)
  })
})

describe('DIMERS_HELD (#342, JD-A-005)', () => {
  it('explains the hold, not a change, and claims none', () => {
    // A reader who already stored `dimers` and then raised Df gets a held
    // control: the sentence must explain the gate without claiming a change
    // that never happened.
    expect(DIMERS_HELD).toMatch(/held/i)
    expect(DIMERS_HELD).not.toMatch(/changed/i)
    expect(DIMERS_HELD).not.toMatch(/recommend/i)
  })

  it('keeps the measured numbers', () => {
    // Same reason as DIMERS_ADVICE: a sentence without the numbers cannot be
    // checked by the reader it is addressed to.
    expect(DIMERS_HELD).toMatch(/2\.37/)
    expect(DIMERS_HELD).toMatch(/2\.7[789]|2\.8/)
  })
})

describe('needsDimers — the only gate (#341)', () => {
  it('holds its measured thresholds', () => {
    // Not a change in this issue: the gate was measured in #311/#315 and is
    // asserted here so a later edit cannot move it quietly.
    expect(HIGH_DF_NEEDS_DIMERS).toBe(2.7)
    expect(HIGH_DF_KF_FLOOR).toBe(1.3)
  })

  it('opens at 2.7 with kf 1.3 and closes one step below either', () => {
    expect(needsDimers(2.7, 1.3)).toBe(true)
    expect(needsDimers(2.9, 1.3)).toBe(true)
    expect(needsDimers(2.6, 1.3)).toBe(false)
    expect(needsDimers(2.7, 1.2)).toBe(false)
  })
})
