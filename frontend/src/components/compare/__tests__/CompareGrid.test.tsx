/**
 * Unit tests for `<CompareGrid>` (T10, change: visualize-multiple).
 *
 * jsdom can't run r3f — we mock `<AgglomerateViewer>` to an inert stub
 * that echoes the props it received, so we can assert on color + scope
 * threading without touching WebGL.
 */
import { render, screen, within } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// AgglomerateViewer stub — surfaces the props the grid feeds into it.
// ---------------------------------------------------------------------------
const viewerProps: Array<Record<string, unknown>> = []

vi.mock('@/components/viewer3d/AgglomerateViewer', () => ({
  AgglomerateViewer: (props: Record<string, unknown>) => {
    viewerProps.push(props)
    const coords = props.coordinates as number[][]
    const cameraSource = props.cameraSource as { scope: string } | undefined
    return (
      <div
        data-testid="viewer-stub"
        data-color={String(props.colorOverride ?? '')}
        data-scope={cameraSource?.scope ?? ''}
        data-count={String(coords?.length ?? 0)}
      />
    )
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks).
// ---------------------------------------------------------------------------
import { CompareCameraProvider } from '../CompareCameraProvider'
import { CompareGrid, type CompareSim } from '../CompareGrid'

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
            [1, 0, 0],
            [0, 1, 0],
          ],
          radii: [0.5, 0.5, 0.5],
        }
      : null,
  }
}

const colorMap: Record<string, string> = {
  'sim-a': '#4E79A7',
  'sim-b': '#F28E2B',
  'sim-c': '#E15759',
}

function wrap(node: React.ReactNode) {
  return <CompareCameraProvider>{node}</CompareCameraProvider>
}

beforeEach(() => {
  viewerProps.length = 0
})

describe('<CompareGrid />', () => {
  it('renders one cell per simulation with the palette border color and label', () => {
    const sims: CompareSim[] = [
      makeSim('sim-a', 'Agg A', true),
      makeSim('sim-b', 'Agg B', true),
      makeSim('sim-c', 'Agg C', true),
    ]
    render(wrap(<CompareGrid simulations={sims} colorMap={colorMap} />))

    const cells = screen.getAllByTestId('compare-grid-cell')
    expect(cells).toHaveLength(3)

    // Each cell's data-color matches the palette, and the label text is
    // present.
    expect(cells[0].getAttribute('data-sim-id')).toBe('sim-a')
    expect(cells[0].getAttribute('data-color')).toBe('#4E79A7')
    expect(within(cells[0]).getByText('Agg A')).toBeTruthy()

    expect(cells[1].getAttribute('data-color')).toBe('#F28E2B')
    expect(within(cells[1]).getByText('Agg B')).toBeTruthy()

    expect(cells[2].getAttribute('data-color')).toBe('#E15759')
    expect(within(cells[2]).getByText('Agg C')).toBeTruthy()
  })

  it('forwards colorOverride + scoped camera to each viewer (synced → shared scope)', () => {
    const sims: CompareSim[] = [
      makeSim('sim-a', 'A', true),
      makeSim('sim-b', 'B', true),
    ]
    render(wrap(<CompareGrid simulations={sims} colorMap={colorMap} />))

    expect(viewerProps).toHaveLength(2)
    expect(viewerProps[0].colorOverride).toBe('#4E79A7')
    expect(viewerProps[1].colorOverride).toBe('#F28E2B')

    // Synced provider → both viewers got the same scope key.
    const stubs = screen.getAllByTestId('viewer-stub')
    expect(stubs[0].getAttribute('data-scope')).toBe(
      stubs[1].getAttribute('data-scope'),
    )
    expect(stubs[0].getAttribute('data-scope')).toMatch(/^compare\//)
  })

  it('applies per-sim nm scaling to coordinates before handing them to the viewer', () => {
    // primary_particle_diameter_nm: 20 → scale = 10. Inputs at 1.0 → 10.0.
    const sims: CompareSim[] = [makeSim('sim-a', 'A', true)]
    render(wrap(<CompareGrid simulations={sims} colorMap={colorMap} />))

    expect(viewerProps).toHaveLength(1)
    const coords = viewerProps[0].coordinates as number[][]
    expect(coords).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ])
    const radii = viewerProps[0].radii as number[]
    expect(radii).toEqual([5, 5, 5])
  })

  it('renders "No geometry data" placeholder for sims without geometry', () => {
    const sims: CompareSim[] = [
      makeSim('sim-a', 'Agg A', true),
      makeSim('sim-b', 'Agg B', false), // missing geometry
    ]
    render(wrap(<CompareGrid simulations={sims} colorMap={colorMap} />))

    // Only one viewer mounted (the sim with geometry).
    expect(screen.getAllByTestId('viewer-stub')).toHaveLength(1)
    // The other cell shows the fallback text.
    expect(screen.getByText('No geometry data')).toBeTruthy()
  })
})
