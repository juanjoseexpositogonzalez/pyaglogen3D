/**
 * Covers design-system-foundation R4 (triple encoding), R5 (the ramp follows
 * the active theme) and R1-S2 (the files this change creates carry no colour
 * literal beyond the documented SSR fallback).
 *
 * jsdom loads no stylesheet, but it does resolve custom properties a test sets
 * itself, so the theme behaviour is exercised by injecting the ramp and then
 * mutating `data-theme`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dash, layout, markEvery, marker, readSeries, series, traceStyle } from '../chart-theme'

const LIGHT = ['#1d858c', '#c25d1e', '#7046b0', '#6f8540', '#a8386b', '#3e6584']
const DARK = ['#58c5c0', '#e8975a', '#a98ae0', '#a8c272', '#e08aa9', '#7fa8cc']

function injectRamp(values: string[]): void {
  for (let i = 0; i < values.length; i++) {
    document.documentElement.style.setProperty('--series-' + (i + 1), values[i])
  }
}

function clearRamp(): void {
  for (let i = 1; i <= 6; i++) {
    document.documentElement.style.removeProperty('--series-' + i)
  }
  document.documentElement.removeAttribute('data-theme')
}

beforeEach(() => injectRamp(LIGHT))
afterEach(clearRamp)

describe('series ramp', () => {
  it('reads the ramp from the document', () => {
    expect(series(0)).toBe('#1d858c')
    expect(series(1)).toBe('#c25d1e')
  })

  it('re-reads the ramp when the theme flips, without a reload', () => {
    expect(series(0)).toBe('#1d858c')

    document.documentElement.setAttribute('data-theme', 'dark')
    injectRamp(DARK)

    expect(series(0)).toBe('#58c5c0')
    expect(series(2)).toBe('#a98ae0')
  })

  it('falls back to the documented literals when a property is absent', () => {
    clearRamp()
    expect(readSeries()[0]).toBe('#1d858c')
  })

  it('wraps around beyond the sixth series', () => {
    expect(series(6)).toBe(series(0))
    expect(dash(7)).toBe(dash(1))
    expect(marker(8)).toBe(marker(2))
  })
})

describe('triple encoding', () => {
  it('gives four series three distinct cues each, indexed alike', () => {
    const traces = [0, 1, 2, 3].map((i) => traceStyle(i, { name: 'sim ' + i }))

    const colours = traces.map((t) => t.line.color)
    const dashes = traces.map((t) => t.line.dash)
    const symbols = traces.map((t) => t.marker.symbol)

    expect(new Set(colours).size).toBe(4)
    expect(new Set(dashes).size).toBe(4)
    expect(new Set(symbols).size).toBe(4)

    traces.forEach((t, i) => {
      expect(t.line.color).toBe(series(i))
      expect(t.line.dash).toBe(dash(i))
      expect(t.marker.symbol).toBe(marker(i))
    })
  })

  it('preserves a colour bound by another capability', () => {
    // multi-aggregate-comparison ties each Rg series to its simulation's
    // colour, shared with that simulation's viewer border. The binding wins.
    const bound = traceStyle(2, { color: '#4E79A7' })

    expect(bound.line.color).toBe('#4E79A7')
    expect(bound.line.dash).toBe(dash(2))
    expect(bound.marker.symbol).toBe(marker(2))
  })

  it('declares all three cues on a legend-bearing trace', () => {
    const t = traceStyle(1, { name: 'second' })
    expect(t.showlegend).toBe(true)
    expect(t.line.dash).toBeTruthy()
    expect(t.marker.symbol).toBeTruthy()
  })

  it('leaves a single series solid and unmarked', () => {
    const t = traceStyle(0, { soleSeries: true })
    expect(t.line.dash).toBe('solid')
    expect(t.marker.size).toBe(0)
    expect(t.mode).toBe('lines')
  })
})

describe('marker thinning', () => {
  it('draws fewer than sixty markers on a five-hundred-point series', () => {
    expect(markEvery(500, 48).length).toBeLessThan(60)
  })

  it('marks every point when the series is short', () => {
    expect(markEvery(12, 48)).toHaveLength(12)
  })

  it('returns nothing for an empty series', () => {
    expect(markEvery(0, 48)).toEqual([])
  })
})

describe('layout', () => {
  it('reads grid and ink from the tokens', () => {
    document.documentElement.style.setProperty('--visual-grid', '#d7e8ec')
    const l = layout() as { xaxis: { gridcolor: string } }
    expect(l.xaxis.gridcolor).toBe('#d7e8ec')
    document.documentElement.style.removeProperty('--visual-grid')
  })

  it('invents no colour when a token is absent', () => {
    // react-plotly.js is loaded with ssr:false everywhere here, so a layout is
    // only built with a document. An absent token leaves Plotly on its own
    // default rather than on a literal this module would have to own.
    const l = layout() as { xaxis: { gridcolor: string } }
    expect(l.xaxis.gridcolor).toBe('')
  })

  it('keeps the plot surface transparent so the panel shows through', () => {
    const l = layout() as { paper_bgcolor: string; plot_bgcolor: string }
    expect(l.paper_bgcolor).toBe('transparent')
    expect(l.plot_bgcolor).toBe('transparent')
  })

  it('accepts overrides', () => {
    const l = layout({ showlegend: false }) as { showlegend: boolean }
    expect(l.showlegend).toBe(false)
  })
})

describe('no colour literals in the files this change creates', () => {
  const roots = ['src/lib/chart-theme.ts']

  it('carries colour literals only in the documented SSR fallback', () => {
    roots.forEach((relative) => {
      const source = readFileSync(join(process.cwd(), relative), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      const hits = code.match(/#[0-9a-fA-F]{3,8}\b/g) || []

      // The six fallback values are the one exception R1 allows.
      expect(hits.length, relative + ' has ' + hits.length + ' literals').toBeLessThanOrEqual(6)
      if (hits.length > 0) {
        expect(code).toMatch(/FALLBACK_SERIES/)
      }
    })
  })
})
