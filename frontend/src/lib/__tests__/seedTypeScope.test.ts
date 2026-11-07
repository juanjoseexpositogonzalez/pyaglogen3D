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
import { relaunchPayloadFor } from '../sinteringWarning'

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
