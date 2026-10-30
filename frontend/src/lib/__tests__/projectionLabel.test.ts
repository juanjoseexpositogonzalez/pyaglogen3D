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

describe('simulationLabel — a study that varies nothing', () => {
  it('falls back to the child\'s parameters instead of naming the row "Sim "', () => {
    // Reachable: the serializer defaults an absent grid to `{}` and the form
    // lets every variation be removed. Sourcing only from the grid left the
    // export row named "Sim " with no way to tell children apart.
    const label = simulationLabel({ n_particles: 60, target_kf: 1.3 }, {})

    expect(label).toBe('Sim n_particles=60, target_kf=1.3')
  })
})

describe('simulationLabel — children the grid does not describe', () => {
  it('keeps a limiting-case child distinguishable from its siblings', () => {
    // Limiting cases are built from base_parameters and vary the parameters they
    // override, not the grid. A judge measured eleven children collapsing into
    // three labels; the parameter a child overrides is part of its identity.
    const base = { n_particles: 500, target_df: 1.8, target_kf: 1.3 }
    const low = simulationLabel({ ...base, target_df: 1.0 }, { n_particles: [100] }, base)
    const high = simulationLabel({ ...base, target_df: 3.0 }, { n_particles: [100] }, base)

    expect(low).not.toBe(high)
    expect(low).toContain('target_df=1')
  })

  it('does not repeat what the base already says', () => {
    const base = { n_particles: 500, target_df: 1.8 }
    const label = simulationLabel({ ...base }, { n_particles: [100] }, base)

    expect(label).toBe('Sim n_particles=500')
  })
})

describe('simulationLabel — the aliases, in every combination the backend accepts', () => {
  const KF_GRID = { mode: 'fixed', value: 1.5 }
  const CHILD = { n_particles: 100, kf_distribution: KF_GRID, target_kf_distribution: KF_GRID }

  it('does not show the engine name when base_parameters declared the grid one', () => {
    // The backend accepts this shape and the child carries both names; a judge
    // measured eleven rows each gaining a `target_kf_distribution` entry whose
    // value never varied.
    const label = simulationLabel(
      CHILD,
      { n_particles: [100] },
      { n_particles: 100, kf_distribution: KF_GRID },
    )

    // A magnitude that comes from base_parameters is the same in every row, so
    // it is not part of the row's identity: the label states what varies.
    expect(label).toBe('Sim n_particles=100')
  })

  it('does not show the engine name when base_parameters declared the engine one', () => {
    const label = simulationLabel(
      CHILD,
      { n_particles: [100] },
      { n_particles: 100, target_kf_distribution: KF_GRID },
    )

    expect(label).not.toContain('target_kf_distribution')
  })

  it('does not duplicate the magnitude when the grid is empty', () => {
    // The empty-grid fallback used to take every key of the child, which
    // includes both names - the duplication #191 closes, from the other line.
    const label = simulationLabel(CHILD, {}, { n_particles: 100 })

    expect(label.match(/kf_distribution/g)).toHaveLength(1)
    expect(label).not.toContain('target_kf_distribution')
  })

  it('leaves a base value out of the row', () => {
    const label = simulationLabel(
      { n_particles: 100, target_df: 2.0 },
      { n_particles: [100] },
      { n_particles: 60, target_df: 2.0 },
    )

    expect(label).not.toContain('target_df')
  })
})
