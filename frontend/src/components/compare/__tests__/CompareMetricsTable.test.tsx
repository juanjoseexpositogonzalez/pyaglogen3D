/**
 * Unit tests for `<CompareMetricsTable>` (T14/T19, change: visualize-multiple).
 *
 * Coverage:
 *   1. One column per sim, header dots wired to palette.
 *   2. Rg row multiplied by each sim's own `getScaleFactorNm(params)`.
 *   3. Null / missing metrics render as em-dash, not "null" or crash.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  CompareMetricsTable,
  type CompareSimWithMetrics,
} from '../CompareMetricsTable'

const colorMap: Record<string, string> = {
  'sim-a': '#4E79A7',
  'sim-b': '#F28E2B',
  'sim-c': '#E15759',
}

function makeSim(overrides: Partial<CompareSimWithMetrics> = {}): CompareSimWithMetrics {
  return {
    id: 'sim-a',
    name: 'Agg A',
    // diameter 20 nm → scale = 10 nm per engine unit
    parameters: { primary_particle_diameter_nm: 20 },
    geometry: null,
    algorithm: 'dlca',
    metrics: {
      fractal_dimension: 1.78,
      prefactor: 1.2,
      radius_of_gyration: 3.5, // engine units → 3.5 × 10 = 35.00 nm
      n_particles: 512,
    },
    ...overrides,
  }
}

describe('<CompareMetricsTable />', () => {
  it('renders one column per simulation with palette-colored headers', () => {
    const sims: CompareSimWithMetrics[] = [
      makeSim({ id: 'sim-a', name: 'Agg A' }),
      makeSim({ id: 'sim-b', name: 'Agg B' }),
      makeSim({ id: 'sim-c', name: 'Agg C' }),
    ]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    const headers = screen.getAllByTestId('compare-metrics-header')
    expect(headers).toHaveLength(3)

    expect(headers[0].getAttribute('data-sim-id')).toBe('sim-a')
    expect(headers[0].getAttribute('data-color')).toBe('#4E79A7')
    expect(headers[1].getAttribute('data-color')).toBe('#F28E2B')
    expect(headers[2].getAttribute('data-color')).toBe('#E15759')

    // Sim names visible in the headers.
    expect(screen.getByText('Agg A')).toBeTruthy()
    expect(screen.getByText('Agg B')).toBeTruthy()
    expect(screen.getByText('Agg C')).toBeTruthy()
  })

  it('renders all five metric rows', () => {
    const sims = [makeSim()]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)
    expect(screen.getByText('Fractal Dimension (Df)')).toBeTruthy()
    expect(screen.getByText('Prefactor (kf)')).toBeTruthy()
    expect(screen.getByText('Radius of Gyration (nm)')).toBeTruthy()
    expect(screen.getByText('N particles')).toBeTruthy()
    expect(screen.getByText('Algorithm')).toBeTruthy()
  })

  it('scales Rg to nm via getScaleFactorNm(parameters)', () => {
    // diameter 20 → scale 10 → Rg 3.5 engine = 35.00 nm
    const sims = [makeSim({ id: 'sim-a', name: 'A' })]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    const cell = screen.getByTestId('metrics-cell-rg')
    expect(cell.textContent).toBe('35.00')
  })

  it('renders formatted Df, kf, n_particles, and algorithm', () => {
    const sims = [makeSim()]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    expect(screen.getByTestId('metrics-cell-df').textContent).toBe('1.780')
    expect(screen.getByTestId('metrics-cell-kf').textContent).toBe('1.200')
    expect(screen.getByTestId('metrics-cell-n').textContent).toBe('512')
    expect(screen.getByTestId('metrics-cell-algorithm').textContent).toBe(
      'dlca',
    )
  })

  it('renders em-dash for null metrics and null algorithm', () => {
    const sims: CompareSimWithMetrics[] = [
      {
        id: 'sim-a',
        name: 'Agg A',
        parameters: { primary_particle_diameter_nm: 20 },
        geometry: null,
        algorithm: null,
        metrics: null,
      },
    ]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    expect(screen.getByTestId('metrics-cell-df').textContent).toBe('—')
    expect(screen.getByTestId('metrics-cell-kf').textContent).toBe('—')
    expect(screen.getByTestId('metrics-cell-rg').textContent).toBe('—')
    expect(screen.getByTestId('metrics-cell-n').textContent).toBe('—')
    expect(screen.getByTestId('metrics-cell-algorithm').textContent).toBe('—')
  })

  it('uses a fallback color when colorMap has no entry for a sim', () => {
    const sims = [makeSim({ id: 'sim-unknown', name: 'Unknown' })]
    render(<CompareMetricsTable simulations={sims} colorMap={{}} />)

    const header = screen.getByTestId('compare-metrics-header')
    expect(header.getAttribute('data-color')).toBe('#999999')
  })
})
