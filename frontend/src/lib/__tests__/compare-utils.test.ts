import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, it, expect } from 'vitest'

import { series } from '../chart-theme'
import {
  MAX_COMPARE_SIMS,
  comparePalette,
  deriveSimName,
  getCompareColorPalette,
  getCompareGridLayout,
  parseCompareSimsParam,
} from '../compare-utils'

/**
 * jsdom loads no stylesheet, so a theme is injected the way the rest of the kit
 * tests do it. The values are `src/app/globals.css`'s own ramps, written out
 * here so a test can drive both themes without a parser in the hot path.
 */
const LIGHT_RAMP = ['#1d858c', '#c25d1e', '#7046b0', '#6f8540', '#a8386b', '#3e6584']
const DARK_RAMP = ['#58c5c0', '#e8975a', '#a98ae0', '#a8c272', '#e08aa9', '#7fa8cc']

function injectRamp(values: string[]): void {
  for (let i = 0; i < values.length; i++) {
    document.documentElement.style.setProperty('--series-' + (i + 1), values[i])
  }
}

function clearRamp(): void {
  for (let i = 1; i <= LIGHT_RAMP.length; i++) {
    document.documentElement.style.removeProperty('--series-' + i)
  }
  delete document.documentElement.dataset.theme
}

beforeEach(() => injectRamp(LIGHT_RAMP))
afterEach(clearRamp)

describe('deriveSimName', () => {
  it('returns the user-assigned name when present', () => {
    expect(
      deriveSimName({ id: 'abc12345def', algorithm: 'dla', name: 'My Agg' }),
    ).toBe('My Agg')
  })

  it('trims whitespace around the name', () => {
    expect(
      deriveSimName({ id: 'abc12345def', algorithm: 'dla', name: '  Trimmed  ' }),
    ).toBe('Trimmed')
  })

  it('falls back to ALGO + short id when name is missing', () => {
    expect(deriveSimName({ id: 'abc12345def', algorithm: 'dla' })).toBe(
      'DLA · abc12345',
    )
  })

  it('falls back when name is empty string', () => {
    expect(
      deriveSimName({ id: 'abc12345def', algorithm: 'tunable_cc', name: '' }),
    ).toBe('TUNABLE_CC · abc12345')
  })

  it('falls back when name is only whitespace', () => {
    expect(
      deriveSimName({ id: 'abc12345def', algorithm: 'dla', name: '   ' }),
    ).toBe('DLA · abc12345')
  })

  it('falls back when name is null', () => {
    expect(
      deriveSimName({ id: 'abc12345def', algorithm: 'cca', name: null }),
    ).toBe('CCA · abc12345')
  })
})

describe('parseCompareSimsParam', () => {
  it('returns empty result for null', () => {
    expect(parseCompareSimsParam(null)).toEqual({ ids: [], truncated: false })
  })

  it('returns empty result for undefined', () => {
    expect(parseCompareSimsParam(undefined)).toEqual({ ids: [], truncated: false })
  })

  it('returns empty result for empty string', () => {
    expect(parseCompareSimsParam('')).toEqual({ ids: [], truncated: false })
  })

  it('parses a simple comma-separated string', () => {
    const out = parseCompareSimsParam('a,b,c')
    expect(out).toEqual({ ids: ['a', 'b', 'c'], truncated: false })
  })

  it('trims whitespace and drops empty tokens', () => {
    const out = parseCompareSimsParam(' a , ,b ,,c  ')
    expect(out).toEqual({ ids: ['a', 'b', 'c'], truncated: false })
  })

  it('deduplicates while preserving first-occurrence order', () => {
    const out = parseCompareSimsParam('a,b,a,c,b')
    expect(out).toEqual({ ids: ['a', 'b', 'c'], truncated: false })
  })

  it('caps at MAX_COMPARE_SIMS and flags truncated', () => {
    const many = Array.from({ length: 15 }, (_, i) => `id-${i}`).join(',')
    const out = parseCompareSimsParam(many)
    expect(out.ids).toHaveLength(MAX_COMPARE_SIMS)
    expect(out.ids).toEqual([
      'id-0',
      'id-1',
      'id-2',
      'id-3',
      'id-4',
      'id-5',
      'id-6',
      'id-7',
      'id-8',
    ])
    expect(out.truncated).toBe(true)
  })

  it('exactly MAX_COMPARE_SIMS is not flagged as truncated', () => {
    const exact = Array.from({ length: MAX_COMPARE_SIMS }, (_, i) => `id-${i}`).join(',')
    const out = parseCompareSimsParam(exact)
    expect(out.ids).toHaveLength(MAX_COMPARE_SIMS)
    expect(out.truncated).toBe(false)
  })

  it('accepts the array form (repeated param style)', () => {
    const out = parseCompareSimsParam(['a,b', 'c'])
    expect(out).toEqual({ ids: ['a', 'b', 'c'], truncated: false })
  })
})

describe('getCompareColorPalette', () => {
  it('returns an empty map for an empty list', () => {
    expect(getCompareColorPalette([])).toEqual({})
  })

  it('gives each simulation the ramp colour of its position', () => {
    const ids = ['c', 'a', 'b']
    const map = getCompareColorPalette(ids)
    // Sorted order is [a, b, c] → series(0), series(1), series(2).
    expect(map.a).toBe(series(0))
    expect(map.b).toBe(series(1))
    expect(map.c).toBe(series(2))
    expect([map.a, map.b, map.c]).toEqual(LIGHT_RAMP.slice(0, 3))
  })

  it('follows the theme: the same ids take the dark ramp', () => {
    const before = getCompareColorPalette(['a', 'b'])

    document.documentElement.dataset.theme = 'dark'
    injectRamp(DARK_RAMP)

    const after = getCompareColorPalette(['a', 'b'])
    expect(after.a).toBe(DARK_RAMP[0])
    expect(after.b).toBe(DARK_RAMP[1])
    // The identity moves with the theme, and its position does not: a is still
    // series 0 and b is still series 1.
    expect(after.a).not.toBe(before.a)
  })

  it('keeps one identity per slot for the nine simulations the page allows', () => {
    const palette = comparePalette()
    expect(palette).toHaveLength(MAX_COMPARE_SIMS)
    expect(palette.slice(0, LIGHT_RAMP.length)).toEqual(LIGHT_RAMP)
    // Beyond the sixth, the ramp repeats by position. A repeated colour is not
    // a repeated identity: the chart also carries a dash pattern and a marker
    // glyph by the same index, and every surface prints the simulation's name.
    expect(palette[LIGHT_RAMP.length]).toBe(palette[0])
  })

  /**
   * The regression this guards: the identities used to be nine Tableau10
   * literals that did not move with the theme, and once the plot's background
   * became the panel's paper (white in the light theme) four of them sat
   * between 1.6:1 and 2.4:1 — below the 3:1 WCAG asks of a graphical object.
   *
   * The values come from `globals.css`, so this fails if the ramp itself ever
   * drops under the floor, which is the only place the colours live.
   */
  it('keeps every identity at or above 3:1 against the paper in both themes', () => {
    const ids = Array.from({ length: MAX_COMPARE_SIMS }, (_, i) => 'sim-' + i)
    const themes = [
      { name: 'light', selector: ':root', attribute: 'light' },
      { name: 'dark', selector: "[data-theme='dark']", attribute: 'dark' },
    ]

    themes.forEach((theme) => {
      const tokens = tokensOf(theme.selector)
      const paper = tokens['--surface-strong']
      expect(paper, theme.name + ': no paper token').toBeTruthy()

      // The ramp in force, then the identities the compare page hands out.
      let injected = 0
      while (tokens['--series-' + (injected + 1)]) {
        injected++
        document.documentElement.style.setProperty(
          '--series-' + injected,
          tokens['--series-' + injected],
        )
      }
      expect(injected, theme.name + ': no ramp').toBeGreaterThan(0)
      document.documentElement.dataset.theme = theme.attribute

      const map = getCompareColorPalette(ids)
      for (let slot = 0; slot < ids.length; slot++) {
        const colour = map[ids[slot]]
        const ratio = contrastRatio(colour, paper)
        expect(
          ratio,
          `${theme.name}: slot ${slot + 1} (${colour}) on ${paper} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3)
      }
    })
  })

  it('is deterministic — same ids give same colors regardless of input order', () => {
    const map1 = getCompareColorPalette(['x', 'y', 'z'])
    const map2 = getCompareColorPalette(['z', 'x', 'y'])
    const map3 = getCompareColorPalette(['y', 'z', 'x'])
    expect(map1).toEqual(map2)
    expect(map2).toEqual(map3)
  })

  it('assigns distinct colors to distinct ids within palette length', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const map = getCompareColorPalette(ids)
    const colors = Object.values(map)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('wraps around the palette for more ids than palette length', () => {
    const palette = comparePalette()
    const ids = Array.from({ length: palette.length + 2 }, (_, i) =>
      // Use a padded index so lexicographic sort matches numeric order.
      `id-${String(i).padStart(2, '0')}`,
    )
    const map = getCompareColorPalette(ids)
    // id-00 gets palette[0], id-09 gets palette[9 % 9] === palette[0] again.
    expect(map['id-00']).toBe(palette[0])
    expect(map[`id-0${palette.length}`]).toBe(palette[0])
  })
})

describe('getCompareGridLayout', () => {
  it('N=2 → 2 cols × 1 row', () => {
    expect(getCompareGridLayout(2)).toEqual({ cols: 2, rows: 1 })
  })

  it('N=3 → 3 cols × 1 row', () => {
    expect(getCompareGridLayout(3)).toEqual({ cols: 3, rows: 1 })
  })

  it('N=4 → 2 cols × 2 rows', () => {
    expect(getCompareGridLayout(4)).toEqual({ cols: 2, rows: 2 })
  })

  it('N=5 and N=6 → 3 cols × 2 rows', () => {
    expect(getCompareGridLayout(5)).toEqual({ cols: 3, rows: 2 })
    expect(getCompareGridLayout(6)).toEqual({ cols: 3, rows: 2 })
  })

  it('N=7, 8, 9 → 3 cols × 3 rows', () => {
    expect(getCompareGridLayout(7)).toEqual({ cols: 3, rows: 3 })
    expect(getCompareGridLayout(8)).toEqual({ cols: 3, rows: 3 })
    expect(getCompareGridLayout(9)).toEqual({ cols: 3, rows: 3 })
  })

  it('N < 2 falls back to 1×1 without throwing', () => {
    expect(getCompareGridLayout(0)).toEqual({ cols: 1, rows: 1 })
    expect(getCompareGridLayout(1)).toEqual({ cols: 1, rows: 1 })
  })
})

/**
 * The tokens of one top-level block of `globals.css`, as text.
 *
 * Parsed rather than read through `getComputedStyle` because jsdom runs no
 * PostCSS, so the sheet the app imports never reaches the test document: the
 * only way to ask what a token really is, is to read the file that declares it.
 * Brace depth is counted because these blocks sit inside `@layer base`.
 */
function tokensOf(selector: string): Record<string, string> {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const start = css.indexOf(selector)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  const body = css.slice(open + 1, end)
  const out: Record<string, string> = {}
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let match = re.exec(body)
  while (match !== null) {
    out[match[1]] = match[2].trim()
    match = re.exec(body)
  }
  return out
}

/** WCAG relative luminance of a six-digit hex colour. */
function luminance(hex: string): number {
  const value = hex.trim().replace('#', '')
  const channel = (offset: number): number => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** WCAG contrast ratio between two hex colours. */
function contrastRatio(a: string, b: string): number {
  const high = Math.max(luminance(a), luminance(b))
  const low = Math.min(luminance(a), luminance(b))
  return (high + 0.05) / (low + 0.05)
}
