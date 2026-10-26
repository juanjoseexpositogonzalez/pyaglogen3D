/**
 * Detection of batch studies that ran before sintering reached the engine.
 *
 * A study configured with `normal` sintering declared a mean that never
 * arrived: the value was stored under a key no consumer read, and the
 * calculation used the 1.0 default, which means no sintering at all. Measured
 * with the same seed, radius of gyration came out 6.83 instead of 5.48 — the
 * saved results do not describe the configuration beside them.
 *
 * Two criteria, deliberately different:
 *
 *   - On a study's own children, the presence of `sintering_mean` is a fact
 *     about the data: production no longer writes that key.
 *   - In a list, only the study is available, so the test falls back to its
 *     declared config plus a date. A date depends on which branch was
 *     deployed, so that criterion may over-report and must never under-report.
 */
import { describe, expect, it } from 'vitest'

import {
  SINTERING_FIX_DEPLOYED_AT,
  classifySintering,
  relaunchConfigFor,
  studyChildrenRanWithoutSintering,
  studyMayHaveRunWithoutSintering,
} from '../sinteringWarning'

const child = (parameters: Record<string, unknown>) => ({ parameters })

describe('detecting children that ran without sintering', () => {
  it('finds the key production no longer writes', () => {
    expect(
      studyChildrenRanWithoutSintering([
        child({ n_particles: 100 }),
        child({ n_particles: 100, sintering_mean: 0.8 }),
      ]),
    ).toBe(true)
  })

  it('reports nothing when no child carries it', () => {
    expect(studyChildrenRanWithoutSintering([child({ n_particles: 100 })])).toBe(false)
  })

  it('reports nothing for a study with no children yet', () => {
    expect(studyChildrenRanWithoutSintering([])).toBe(false)
  })
})

describe('flagging a study from the list alone', () => {
  const before = '2026-10-20T10:00:00Z'
  const after = new Date(Date.parse(SINTERING_FIX_DEPLOYED_AT) + 86_400_000).toISOString()

  it('flags a normal-sintering study created before the fix was deployed', () => {
    expect(
      studyMayHaveRunWithoutSintering({
        created_at: before,
        sintering_config: { type: 'normal', mean: 0.8, std: 0.05 },
      }),
    ).toBe(true)
  })

  it('uses the deployment date, not the date the fix merged to develop', () => {
    // The fix reached `develop` on 2026-10-25 but users ran against `main`,
    // which only received it with the release. A study created in between is
    // affected, and a cutoff taken from the merge date would miss it.
    const inBetween = '2026-10-25T12:00:00Z'

    expect(
      studyMayHaveRunWithoutSintering({
        created_at: inBetween,
        sintering_config: { type: 'normal', mean: 0.8, std: 0.05 },
      }),
    ).toBe(true)
  })

  it('does not flag a study created after the fix was deployed', () => {
    expect(
      studyMayHaveRunWithoutSintering({
        created_at: after,
        sintering_config: { type: 'normal', mean: 0.8, std: 0.05 },
      }),
    ).toBe(false)
  })

  it('does not flag fixed or uniform sintering, which did reach the engine', () => {
    for (const type of ['fixed', 'uniform']) {
      expect(
        studyMayHaveRunWithoutSintering({
          created_at: before,
          sintering_config: { type, mean: 0.8 },
        }),
      ).toBe(false)
    }
  })

  it('does not flag a study that declared no sintering at all', () => {
    expect(studyMayHaveRunWithoutSintering({ created_at: before })).toBe(false)
    expect(
      studyMayHaveRunWithoutSintering({ created_at: before, sintering_config: null }),
    ).toBe(false)
  })

  it('survives a config that is not the shape it claims', () => {
    // These come from stored JSON, so nothing guarantees the shape. A crash
    // here would take down the whole list for everyone.
    expect(
      studyMayHaveRunWithoutSintering({ created_at: before, sintering_config: 'normal' }),
    ).toBe(false)
    expect(
      studyMayHaveRunWithoutSintering({ created_at: 'not a date', sintering_config: { type: 'normal' } }),
    ).toBe(false)
  })
})

describe('old configurations spell the kind three different ways', () => {
  const before = '2026-10-20T10:00:00Z'

  // The selector used to send `mode`, the API later spoke `distribution_type`,
  // and `type` appears in stored rows too. A criterion that knows only one of
  // them clears studies it cannot actually read.
  it.each(['distribution_type', 'type', 'mode'])('reads `%s`', (key) => {
    expect(
      studyMayHaveRunWithoutSintering({
        created_at: before,
        sintering_config: { [key]: 'normal', mean: 0.8, std: 0.05 },
      }),
    ).toBe(true)
  })
})

describe('telling a corrected defect from an expectation that never held', () => {
  const before = '2026-10-20T10:00:00Z'
  const normal = { distribution_type: 'normal', mean: 0.8, std: 0.05 }

  it('calls it affected when the algorithm does consume sintering', () => {
    expect(
      classifySintering({ created_at: before, sintering_config: normal, base_algorithm: 'tunable_cc' }),
    ).toBe('affected')
  })

  it('calls it never-consumed for the algorithms that ignore sintering', () => {
    // These did not run without sintering because of the defect: they never
    // could sinter at all. Showing the same warning would merge a fixed bug
    // with a user expectation that was always wrong.
    for (const algorithm of ['fracval', 'gcca', 'box_rfa', 'imported'] as const) {
      expect(
        classifySintering({ created_at: before, sintering_config: normal, base_algorithm: algorithm }),
      ).toBe('never-consumed')
    }
  })

  it('calls it unaffected when the kind did reach the engine', () => {
    expect(
      classifySintering({
        created_at: before,
        sintering_config: { distribution_type: 'uniform', min: 0.5, max: 0.9 },
        base_algorithm: 'tunable_cc',
      }),
    ).toBe('unaffected')
  })
})

describe('what a relaunch may send', () => {
  const before = '2026-10-20T10:00:00Z'

  it('normalises the stored spelling into the one the API accepts', () => {
    expect(
      relaunchConfigFor({
        created_at: before,
        sintering_config: { mode: 'normal', mean: 0.8, std: 0.05 },
        base_algorithm: 'tunable_cc',
      }),
    ).toEqual({ distribution_type: 'normal', mean: 0.8, std: 0.05 })
  })

  it('refuses when the stored config lacks what the API requires', () => {
    // Old rows can omit `std`, because nothing read it. Sending that produces
    // a 400 on a page with no error handling: a dead button.
    expect(
      relaunchConfigFor({
        created_at: before,
        sintering_config: { type: 'normal', mean: 0.8 },
        base_algorithm: 'tunable_cc',
      }),
    ).toBeNull()
  })

  it('refuses for an algorithm that cannot receive sintering', () => {
    expect(
      relaunchConfigFor({
        created_at: before,
        sintering_config: { distribution_type: 'normal', mean: 0.8, std: 0.05 },
        base_algorithm: 'gcca',
      }),
    ).toBeNull()
  })
})
