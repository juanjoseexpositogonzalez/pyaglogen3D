/**
 * WCAG AA contrast, asserted rather than measured by hand.
 *
 * A blind review found six token pairs below 4.5:1 in the light theme, after
 * T7.5 had been left as a manual step. A manual measurement is a snapshot; a
 * token can drift the day after it is taken. This file turns the guarantee
 * into something that fails in CI.
 *
 * Covers design-system-foundation R8-S1.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  .replace(/\r/g, '')
  // Comments are stripped before parsing: prose that mentions a token by name,
  // such as "contrast against --visual-background", otherwise matches the
  // declaration regex and swallows the declaration that follows it.
  .replace(/\/\*[\s\S]*?\*\//g, '')

function blockOf(selector: string): string {
  const start = css.indexOf(selector)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced block for ${selector}`)
}

function tokensOf(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = blockOf(selector)
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m = re.exec(body)
  while (m !== null) {
    out[m[1]] = m[2].trim()
    m = re.exec(body)
  }
  return out
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Parse `rgba(r, g, b, a)` or `#rrggbb` into channels plus alpha.
 *
 * The kit renders state ink on translucent `*-soft` tints, so the background a
 * chip really presents is that tint composited over the surface beneath it.
 */
function parseColour(value: string): { r: number; g: number; b: number; a: number } {
  const rgba = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/,
  )
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  const h = value.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 1,
  }
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Composite a possibly translucent colour over an opaque one. */
function composite(over: string, base: string): string {
  const f = parseColour(over)
  const b = parseColour(base)
  return toHex(
    f.r * f.a + b.r * (1 - f.a),
    f.g * f.a + b.g * (1 - f.a),
    f.b * f.a + b.b * (1 - f.a),
  )
}

const light = tokensOf(':root')
const dark = tokensOf("[data-theme='dark']")

const AA = 4.5

/**
 * The surfaces the kit actually renders on. The page canvas is the darkest of
 * them in the light theme, and therefore the honest background to measure
 * against: for dark ink a lighter background raises the ratio, so measuring on
 * white would be the optimistic bound, not the conservative one.
 */
const SURFACES = {
  // The darkest surface each theme declares, which is the honest background:
  // for dark ink a lighter background raises the ratio, and for light ink a
  // darker one does. Measuring on --canvas passed while the chips failed on
  // --canvas-deep and on the final stop of --shell-background.
  light: { worst: '#e7f0f0', surface: '#ffffff' },
  dark: { worst: '#12303d', surface: '#102733' },
}

describe('WCAG AA contrast of the token palette', () => {
  const inkTokens = ['--ink', '--ink-strong', '--ink-muted', '--ink-faint']
  const accentTokens = ['--accent', '--accent-strong']

  it.each([...inkTokens, ...accentTokens])(
    '%s clears AA on the darkest light surface',
    (token) => {
      const ratio = contrastRatio(light[token], SURFACES.light.worst)
      expect(
        ratio,
        `${token} ${light[token]} on the canvas is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA)
    },
  )

  it.each([...inkTokens, ...accentTokens])('%s clears AA on the darkest dark surface', (token) => {
    const ratio = contrastRatio(dark[token], SURFACES.dark.worst)
    expect(
      ratio,
      `${token} ${dark[token]} on the canvas is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA)
  })

  // The pairs the chips and badges really present: state ink on its own tint,
  // composited over the darkest surface of the theme. Measuring the ink on a
  // bare surface would pass while the component itself failed, which is what
  // a first attempt at this test did.
  const STATE_PAIRS = [
    ['--success', '--success-soft'],
    ['--warning', '--warning-soft'],
    ['--danger', '--danger-soft'],
  ] as const

  it.each(STATE_PAIRS)('%s on %s clears AA in the light theme', (ink, tint) => {
    const background = composite(light[tint], SURFACES.light.worst)
    const ratio = contrastRatio(light[ink], background)
    expect(
      ratio,
      `${ink} ${light[ink]} on ${tint} composited to ${background} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA)
  })

  it.each(STATE_PAIRS)('%s on %s clears AA in the dark theme', (ink, tint) => {
    const background = composite(dark[tint], SURFACES.dark.worst)
    const ratio = contrastRatio(dark[ink], background)
    expect(
      ratio,
      `${ink} ${dark[ink]} on ${tint} composited to ${background} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA)
  })

  it.each([
    ['--ink-muted', 'light'],
    ['--ink-muted', 'dark'],
  ] as const)('%s on --surface-soft clears AA (%s), the neutral chips', (token, theme) => {
    const tokens = theme === 'light' ? light : dark
    const surfaces = theme === 'light' ? SURFACES.light : SURFACES.dark
    const background = composite(tokens['--surface-soft'], surfaces.worst)
    const ratio = contrastRatio(tokens[token], background)
    expect(
      ratio,
      `${token} on --surface-soft composited to ${background} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA)
  })

  it('keeps the visualisation caption legible, which no theme toggle can rescue', () => {
    // The canvas is near-black in both themes, so these tokens are the only
    // thing between the 3D readouts and invisibility. An opacity modifier here
    // once produced 1.28:1.
    const canvas = light['--visual-background']
    ;['--ink-on-dark', '--ink-on-dark-faint'].forEach((token) => {
      const ratio = contrastRatio(light[token], canvas)
      expect(ratio, `${token} on the canvas is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    })
  })

  it('keeps every series colour distinguishable from the plot surface', () => {
    // Series colours carry lines and markers rather than text, so 3:1 is the
    // bar for non-text contrast.
    for (let i = 1; i <= 6; i++) {
      const ratio = contrastRatio(light[`--series-${i}`], SURFACES.light.worst)
      expect(ratio, `--series-${i} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })
})
