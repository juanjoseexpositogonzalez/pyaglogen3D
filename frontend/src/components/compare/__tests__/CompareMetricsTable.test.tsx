/**
 * Unit tests for `<CompareMetricsTable>` (T14/T19, change: visualize-multiple;
 * migrated to the design-system kit by issue #175, slice 2).
 *
 * Coverage:
 *   1. One column per sim, header markers wired to the palette.
 *   2. Rg row multiplied by each sim's own `getScaleFactorNm(params)`.
 *   3. Null / missing metrics render as an em dash, not "null" and not a crash.
 *   4. The readings are the kit's readings: the value and its unit are separate
 *      elements, and the count is grouped the way the rest of the product
 *      prints numbers.
 *
 * Asserted through what a reader perceives — caption, column headers, cell
 * text — rather than through which components were imported, because a test
 * that checks imports passes a refactor that breaks the screen.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen, within } from '@testing-library/react'
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

/** `Fractal Dimension (Df)` is a regex full of syntax; match it literally. */
function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/** The cell of `row` whose column header names simulation `simName`. */
function cellOf(metricLabel: string, simName: string): HTMLElement {
  const table = screen.getByRole('table')
  const headers = within(table).getAllByRole('columnheader')
  const column = headers.findIndex((h) => (h.textContent ?? '').includes(simName))
  const row = within(table).getByRole('row', { name: literal(metricLabel) })
  return within(row).getAllByRole('cell')[column]
}

/** The colour marker a simulation's column header paints. */
function headerMarker(simName: string): HTMLElement {
  const header = screen
    .getAllByRole('columnheader')
    .find((h) => (h.textContent ?? '').includes(simName)) as HTMLElement
  return header.querySelector('[aria-hidden="true"]') as HTMLElement
}

describe('<CompareMetricsTable />', () => {
  it('names what the table is and what one column holds', () => {
    const sims = [makeSim({ id: 'sim-a', name: 'Agg A' })]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    // Without a caption the table is a grid of numbers with no claim attached
    // to them; a screen reader announces the table and nothing else.
    const caption = screen.getByRole('table').querySelector('caption')
    expect(caption?.textContent).toMatch(/one column per simulation/i)
  })

  it('renders one column per simulation with palette-coloured headers', () => {
    const sims: CompareSimWithMetrics[] = [
      makeSim({ id: 'sim-a', name: 'Agg A' }),
      makeSim({ id: 'sim-b', name: 'Agg B' }),
      makeSim({ id: 'sim-c', name: 'Agg C' }),
    ]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    // The metric label column plus one per simulation.
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)

    expect(headerMarker('Agg A').style.backgroundColor).toBe('rgb(78, 121, 167)')
    expect(headerMarker('Agg B').style.backgroundColor).toBe('rgb(242, 142, 43)')
    expect(headerMarker('Agg C').style.backgroundColor).toBe('rgb(225, 87, 89)')
  })

  it('renders all five metric rows', () => {
    const sims = [makeSim()]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    for (const label of [
      'Fractal Dimension (Df)',
      'Prefactor (kf)',
      'Radius of Gyration',
      'N particles',
      'Algorithm',
    ]) {
      expect(screen.getByRole('row', { name: literal(label) })).toBeTruthy()
    }
  })

  it('scales Rg to nm via getScaleFactorNm(parameters)', () => {
    // diameter 20 → scale 10 → Rg 3.5 engine = 35.00 nm
    const sims = [makeSim({ id: 'sim-a', name: 'A' })]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    expect(cellOf('Radius of Gyration', 'A').textContent).toBe('35.00nm')
  })

  it('keeps the unit out of the number, as the kit does everywhere else', () => {
    const sims = [makeSim({ id: 'sim-a', name: 'A' })]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    const cell = cellOf('Radius of Gyration', 'A')
    const value = cell.querySelector('.num')
    const unit = cell.querySelector('.num-unit')

    // The number carries tabular figures so decimal separators line up down a
    // column; the unit sits beside it, in its own element, so it does not.
    expect(value?.textContent).toBe('35.00')
    expect(unit?.textContent).toBe('nm')
  })

  it('groups thousands in the particle count', () => {
    const sims = [
      makeSim({ metrics: { ...makeSim().metrics!, n_particles: 1200 } }),
    ]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    // 100,000-particle agglomerates read with a grouping separator, like every
    // other count in the product; "1200" is a different number to scan.
    expect(cellOf('N particles', 'Agg A').textContent).toBe('1,200')
  })

  it('renders formatted Df, kf, and algorithm', () => {
    const sims = [makeSim()]
    render(<CompareMetricsTable simulations={sims} colorMap={colorMap} />)

    expect(cellOf('Fractal Dimension (Df)', 'Agg A').textContent).toBe('1.780')
    expect(cellOf('Prefactor (kf)', 'Agg A').textContent).toBe('1.200')
    expect(cellOf('Algorithm', 'Agg A').textContent).toBe('dlca')
  })

  it('renders an em dash for null metrics and a null algorithm', () => {
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

    for (const label of [
      'Fractal Dimension (Df)',
      'Prefactor (kf)',
      'Radius of Gyration',
      'N particles',
      'Algorithm',
    ]) {
      expect(cellOf(label, 'Agg A').textContent).toBe('—')
    }
  })

  it('falls back to the series ramp when the palette has no entry for a sim', () => {
    const sims = [makeSim({ id: 'sim-a', name: 'A' }), makeSim({ id: 'sim-b', name: 'B' })]
    render(<CompareMetricsTable simulations={sims} colorMap={{}} />)

    // The fallback is not one grey for everybody: two simulations that arrive
    // without a palette entry still have to be told apart, so the kit's ramp is
    // read by column position.
    const first = headerMarker('A').style.backgroundColor
    const second = headerMarker('B').style.backgroundColor
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })
})
