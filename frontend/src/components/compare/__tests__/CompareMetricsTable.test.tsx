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

import { series } from '@/lib/chart-theme'
import { getCompareColorPalette } from '@/lib/compare-utils'

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

/**
 * The column of a simulation, matched on the header's whole text.
 *
 * A substring match here is a trap the first version of this file fell into:
 * "A" is contained in "Agg A", so every lookup landed on the first column and
 * the assertions passed for the wrong cell.
 */
function columnOf(simName: string): number {
  const headers = screen.getAllByRole('columnheader')
  for (let i = 0; i < headers.length; i++) {
    if ((headers[i].textContent ?? '') === simName) return i
  }
  throw new Error('no column headed ' + simName)
}

/** The cell of `metricLabel`'s row, in `simName`'s column. */
function cellOf(metricLabel: string, simName: string): HTMLElement {
  const table = screen.getByRole('table')
  const row = within(table).getByRole('row', { name: literal(metricLabel) })
  return within(row).getAllByRole('cell')[columnOf(simName)]
}

/** The colour marker a simulation's column header paints. */
function headerMarker(simName: string): HTMLElement {
  const header = screen.getAllByRole('columnheader')[columnOf(simName)]
  return header.querySelector('[aria-hidden="true"]') as HTMLElement
}

/** jsdom normalises an inline colour to `rgb()`, which is what it hands back. */
function rgb(hex: string): string {
  const value = hex.replace('#', '')
  return (
    'rgb(' +
    parseInt(value.slice(0, 2), 16) +
    ', ' +
    parseInt(value.slice(2, 4), 16) +
    ', ' +
    parseInt(value.slice(4, 6), 16) +
    ')'
  )
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

  it('takes each column marker from the identity the map gives its simulation', () => {
    // The page hands this table the same map the chart and the grid read, whose
    // values are the theme's ramp in slot order. Asserted exactly: two colours
    // that merely differ would pass with the wrong two.
    const map = getCompareColorPalette(['sim-a', 'sim-b'])
    const sims = [
      makeSim({ id: 'sim-a', name: 'Agg A' }),
      makeSim({ id: 'sim-b', name: 'Agg B' }),
    ]
    render(<CompareMetricsTable simulations={sims} colorMap={map} />)

    expect(headerMarker('Agg A').style.backgroundColor).toBe(rgb(series(0)))
    expect(headerMarker('Agg B').style.backgroundColor).toBe(rgb(series(1)))
    expect(headerMarker('Agg A').style.backgroundColor).toBe(rgb(map['sim-a']))
  })

  it('lets the panel be the frame instead of drawing a box inside it', () => {
    render(<CompareMetricsTable simulations={[makeSim()]} colorMap={colorMap} />)

    // The table lives inside a kit `Panel`; a border and a radius of its own put
    // a second frame a few pixels inside the first.
    const box = screen.getByRole('table').parentElement as HTMLElement
    expect(box.className).not.toMatch(/border/)
    expect(box.className).not.toMatch(/rounded/)
  })
})
