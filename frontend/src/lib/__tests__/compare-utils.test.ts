import { describe, it, expect } from 'vitest'
import {
  COMPARE_PALETTE,
  MAX_COMPARE_SIMS,
  deriveSimName,
  getCompareColorPalette,
  getCompareGridLayout,
  parseCompareSimsParam,
} from '../compare-utils'

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

  it('assigns palette colors in lexicographic order of ids', () => {
    const ids = ['c', 'a', 'b']
    const map = getCompareColorPalette(ids)
    // Sorted order is [a, b, c] → palette[0], palette[1], palette[2]
    expect(map.a).toBe(COMPARE_PALETTE[0])
    expect(map.b).toBe(COMPARE_PALETTE[1])
    expect(map.c).toBe(COMPARE_PALETTE[2])
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
    const ids = Array.from({ length: COMPARE_PALETTE.length + 2 }, (_, i) =>
      // Use a padded index so lexicographic sort matches numeric order.
      `id-${String(i).padStart(2, '0')}`,
    )
    const map = getCompareColorPalette(ids)
    // id-00 gets palette[0], id-09 gets palette[9 % 9] === palette[0] again.
    expect(map['id-00']).toBe(COMPARE_PALETTE[0])
    expect(map[`id-0${COMPARE_PALETTE.length}`]).toBe(COMPARE_PALETTE[0])
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
