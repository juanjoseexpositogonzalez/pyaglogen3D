import { describe, it, expect } from 'vitest'
import { simulationLabel } from '../projectionLabel'

// ---------------------------------------------------------------------------
// Issue #191 — the projection export panel labelled each child twice and with a
// placeholder.
//
// The page composed the name from `Object.entries(r.parameters)`, so every
// distribution appeared under both of its names - the grid-facing one and the
// engine one, which R13.10 requires the child to carry - and interpolated the
// object, which renders as `[object Object]`. The other four result views derive
// their columns from `parameter_grid.keys()` and were unaffected; this was the
// one place that composed from `parameters`.
// ---------------------------------------------------------------------------

const GRID = { kf_distribution: [{ mode: 'fixed', value: 1.5 }], n_particles: [60] }
const KF = { mode: 'fixed', value: 1.5 }

describe('simulationLabel', () => {
  it('names each varying parameter once, with its value', () => {
    const label = simulationLabel({ kf_distribution: KF, n_particles: 60 }, GRID)

    expect(label).toBe('Sim kf_distribution={"mode":"fixed","value":1.5}, n_particles=60')
  })

  it('ignores the keys the grid does not vary', () => {
    // The child carries the engine name too; it is the same magnitude and must
    // not appear a second time.
    const label = simulationLabel(
      { kf_distribution: KF, target_kf_distribution: KF, n_particles: 60 },
      GRID,
    )

    expect(label).not.toContain('target_kf_distribution')
    expect(label.match(/kf_distribution/g)).toHaveLength(1)
  })

  it('never prints a placeholder for a distribution', () => {
    const label = simulationLabel({ kf_distribution: KF }, GRID)

    expect(label).not.toContain('[object Object]')
    expect(label).toContain('"value":1.5')
  })

  it('reads an absent varying parameter as an em dash, like the views', () => {
    expect(simulationLabel({ n_particles: 60 }, GRID)).toContain('kf_distribution=—')
  })
})
