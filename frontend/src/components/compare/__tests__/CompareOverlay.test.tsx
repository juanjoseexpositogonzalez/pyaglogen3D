/**
 * Unit tests for `<CompareOverlay>` (T11, change: visualize-multiple).
 *
 * jsdom has no WebGL, so we replace the r3f Canvas + drei OrbitControls
 * + `<Particles>` with inert DOM stubs. We then assert on:
 *
 *   - how many Particles got mounted inside the Canvas
 *   - the `uniformColor` each one received (matches the palette)
 *   - the legend has one entry per sim with matching colors
 *   - sims with null geometry are skipped (no Particles, no legend row)
 *     — actually, the legend DOES list them (design choice: show user
 *     the sim is part of the comparison even if its geometry failed),
 *     so we assert the Particles count vs legend count diverges.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks: r3f Canvas + drei + <Particles>. Must be defined BEFORE the
// component import so Vitest hoists them correctly.
// ---------------------------------------------------------------------------
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="canvas-stub">{children}</div>
  ),
}))

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="orbit-controls-stub" />,
}))

const particlesProps: Array<Record<string, unknown>> = []

vi.mock('@/components/viewer3d/Particles', () => ({
  Particles: (props: Record<string, unknown>) => {
    particlesProps.push(props)
    return (
      <div
        data-testid="particles-stub"
        data-color={String(props.uniformColor ?? '')}
      />
    )
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks).
// ---------------------------------------------------------------------------
import { CompareOverlay } from '../CompareOverlay'
import type { CompareSim } from '../CompareGrid'

function makeSim(
  id: string,
  name: string,
  withGeometry: boolean,
): CompareSim {
  return {
    id,
    name,
    parameters: { primary_particle_diameter_nm: 20 }, // scale = 10 nm
    geometry: withGeometry
      ? {
          coordinates: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          radii: [1, 1, 1],
        }
      : null,
  }
}

const colorMap: Record<string, string> = {
  'sim-a': '#4E79A7',
  'sim-b': '#F28E2B',
  'sim-c': '#E15759',
}

beforeEach(() => {
  particlesProps.length = 0
})

describe('<CompareOverlay />', () => {
  it('mounts one Canvas and one Particles per simulation with geometry', () => {
    const sims: CompareSim[] = [
      makeSim('sim-a', 'A', true),
      makeSim('sim-b', 'B', true),
      makeSim('sim-c', 'C', true),
    ]
    render(<CompareOverlay simulations={sims} colorMap={colorMap} />)

    expect(screen.getAllByTestId('canvas-stub')).toHaveLength(1)
    const stubs = screen.getAllByTestId('particles-stub')
    expect(stubs).toHaveLength(3)

    // Each Particles got its palette color.
    expect(stubs[0].getAttribute('data-color')).toBe('#4E79A7')
    expect(stubs[1].getAttribute('data-color')).toBe('#F28E2B')
    expect(stubs[2].getAttribute('data-color')).toBe('#E15759')
  })

  it('centers each aggregate on its own center of mass', () => {
    // With all coords at [2,0,0], [0,2,0], [0,0,0] and equal radii, CoM
    // is (scale * 2/3, scale * 2/3, 0) = (6.67, 6.67, 0). After
    // centering, the cloud should be translated so CoM sits at origin.
    const sims: CompareSim[] = [makeSim('sim-a', 'A', true)]
    render(<CompareOverlay simulations={sims} colorMap={colorMap} />)

    expect(particlesProps).toHaveLength(1)
    const coords = particlesProps[0].coordinates as number[][]

    // Sum of centered coordinates per axis should be ~0 for equal
    // masses (which is what CoM-centering guarantees).
    const sumX = coords.reduce((acc, [x]) => acc + x, 0)
    const sumY = coords.reduce((acc, [, y]) => acc + y, 0)
    const sumZ = coords.reduce((acc, [, , z]) => acc + z, 0)

    // Equal-mass particles → weighted CoM = geometric centroid, so
    // centered sum should be numerically zero (within FP tolerance).
    expect(Math.abs(sumX)).toBeLessThan(1e-9)
    expect(Math.abs(sumY)).toBeLessThan(1e-9)
    expect(Math.abs(sumZ)).toBeLessThan(1e-9)
  })

  it('renders the legend with one entry per simulation (including failed geometry)', () => {
    const sims: CompareSim[] = [
      makeSim('sim-a', 'Agg Alpha', true),
      makeSim('sim-b', 'Agg Beta', false), // no geometry
      makeSim('sim-c', 'Agg Gamma', true),
    ]
    render(<CompareOverlay simulations={sims} colorMap={colorMap} />)

    const entries = screen.getAllByTestId('compare-overlay-legend-entry')
    // Legend lists every sim, including the one without geometry —
    // user still sees it's part of the comparison set.
    expect(entries).toHaveLength(3)
    expect(entries[0].getAttribute('data-color')).toBe('#4E79A7')
    expect(entries[1].getAttribute('data-color')).toBe('#F28E2B')
    expect(entries[2].getAttribute('data-color')).toBe('#E15759')

    // But only 2 Particles (sim-b was skipped due to null geometry).
    expect(screen.getAllByTestId('particles-stub')).toHaveLength(2)

    // Legend labels are the sim names.
    expect(screen.getByText('Agg Alpha')).toBeTruthy()
    expect(screen.getByText('Agg Beta')).toBeTruthy()
    expect(screen.getByText('Agg Gamma')).toBeTruthy()
  })

  it('renders an empty canvas and empty legend for an empty sim list', () => {
    render(<CompareOverlay simulations={[]} colorMap={{}} />)

    expect(screen.getByTestId('canvas-stub')).toBeTruthy()
    expect(screen.queryAllByTestId('particles-stub')).toHaveLength(0)
    expect(screen.queryAllByTestId('compare-overlay-legend-entry')).toHaveLength(
      0,
    )
  })
})
