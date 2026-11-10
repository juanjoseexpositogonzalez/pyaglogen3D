/**
 * The client half of #115 point 14: the form must not offer what the server refuses.
 *
 * Measured by the post-hoc judges on the server change: `BatchSimulationForm`
 * pushed a `seed_type` variation for every algorithm but `limiting`, and the
 * relaunch payload copied a stored `seed_type` verbatim, so both produced a
 * payload the server had just started refusing. `BatchSimulationForm.tsx` belongs
 * to another session; these two functions do not.
 */
import { describe, expect, it } from 'vitest'

import { consumesSeedType, rejectsVariation } from '../sinteringShape'
import { relaunchPayloadFor, relaunchRefusal } from '../sinteringWarning'

describe('seed type scope on the client', () => {
  it('knows the one algorithm that samples it', () => {
    expect(consumesSeedType('tunable_cc')).toBe(true)
    expect(consumesSeedType('fracval')).toBe(false)
    expect(consumesSeedType('tunable')).toBe(false)
    expect(consumesSeedType('ballistic_cc')).toBe(false)
  })

  it('rejects the variation for every algorithm that does not read it', () => {
    expect(rejectsVariation('fracval', 'seed_type')).toBe(true)
    expect(rejectsVariation('tunable', 'seed_type')).toBe(true)
    expect(rejectsVariation('tunable_cc', 'seed_type')).toBe(false)
  })

  it('leaves the other variations alone', () => {
    expect(rejectsVariation('tunable_cc', 'n_particles')).toBe(false)
  })

  it('does not re-send a stored seed_type the target algorithm never reads', () => {
    const payload = relaunchPayloadFor(
      {
        id: 's1',
        name: 'Old study',
        description: '',
        base_algorithm: 'fracval',
        base_parameters: { n_particles: 60, seed_type: 'dimers' },
        parameter_grid: { seed_type: ['dimers'], target_df: [1.5] },
        seeds_per_combination: 1,
        sintering_config: { distribution_type: 'fixed', coefficient: 0.8 },
      } as never,
      { distribution_type: 'fixed', coefficient: 0.9 },
    )

    expect(payload).not.toBeNull()
    expect(payload!.base_parameters).not.toHaveProperty('seed_type')
    expect(payload!.parameter_grid).not.toHaveProperty('seed_type')
    expect(payload!.parameter_grid).toHaveProperty('target_df')
  })

  it('also strips it from the swept extremes carrier', () => {
    // The third carrier. A judge measured that stripping only two of three left
    // the relaunch of such a study as a guaranteed 400.
    const payload = relaunchPayloadFor(
      {
        id: 's3',
        name: 'Old study with swept extremes',
        description: '',
        base_algorithm: 'fracval',
        base_parameters: { n_particles: 60 },
        parameter_grid: {},
        seeds_per_combination: 1,
        include_limiting_cases: true,
        limiting_cases_config: {
          include_theoretical: true,
          theoretical_extremes: { seed_type: ['dimers'], target_df: [1.8] },
        },
        sintering_config: { distribution_type: 'fixed', coefficient: 0.8 },
      } as never,
      { distribution_type: 'fixed', coefficient: 0.9 },
    )

    expect(payload).not.toBeNull()
    const extremes = (payload!.limiting_cases_config as { theoretical_extremes: Record<string, unknown> })
      .theoretical_extremes
    expect(extremes).not.toHaveProperty('seed_type')
    expect(extremes).toHaveProperty('target_df')
  })

  it('keeps it for the algorithm that reads it', () => {
    const payload = relaunchPayloadFor(
      {
        id: 's2',
        name: 'Old tunable_cc study',
        description: '',
        base_algorithm: 'tunable_cc',
        base_parameters: { n_particles: 60, seed_type: 'dimers' },
        parameter_grid: {},
        seeds_per_combination: 1,
        sintering_config: { distribution_type: 'fixed', coefficient: 0.8 },
      } as never,
      { distribution_type: 'fixed', coefficient: 0.9 },
    )

    expect(payload!.base_parameters).toHaveProperty('seed_type', 'dimers')
  })
})


describe('#236 - a relaunch the page cannot build says so', () => {
  it('names the reason instead of returning silently', () => {
    const message = relaunchRefusal(null)
    expect(message).toMatch(/cannot be relaunched from here/i)
    expect(message).toMatch(/not a shape this page can normalise/i)
  })

  it('says nothing when there is a payload', () => {
    expect(relaunchRefusal({ name: 'x' })).toBeNull()
  })
})
