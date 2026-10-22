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

const light = tokensOf(':root')
const dark = tokensOf("[data-theme='dark']")

/**
 * The chips and badges render their ink on a translucent `*-soft` background
 * that composites over the surface, so the surface itself is the conservative
 * background to measure against: it is the lightest the composite can be.
 */
const LIGHT_SURFACE = '#ffffff'
const DARK_SURFACE = '#102733'

const AA = 4.5

describe('WCAG AA contrast of the token palette', () => {
  const inkTokens = ['--ink', '--ink-strong', '--ink-muted', '--ink-faint']
  const stateTokens = ['--success', '--warning', '--danger', '--accent', '--accent-strong']

  it.each([...inkTokens, ...stateTokens])(
    '%s clears AA as small text in the light theme',
    (token) => {
      const ratio = contrastRatio(light[token], LIGHT_SURFACE)
      expect(ratio, `${token} ${light[token]} on white is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    },
  )

  it.each([...inkTokens, ...stateTokens])(
    '%s clears AA as small text in the dark theme',
    (token) => {
      const ratio = contrastRatio(dark[token], DARK_SURFACE)
      expect(ratio, `${token} ${dark[token]} on ${DARK_SURFACE} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    },
  )

  it('keeps the visualisation caption legible, which no theme toggle can rescue', () => {
    // The canvas is near-black in both themes, so these two tokens are the
    // only thing standing between the 3D readouts and invisibility. An
    // opacity modifier here once produced 1.28:1.
    const canvas = light['--visual-background']
    ;['--ink-on-dark', '--ink-on-dark-soft', '--ink-on-dark-faint'].forEach((token) => {
      const ratio = contrastRatio(light[token], canvas)
      expect(ratio, `${token} on the canvas is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    })
  })

  it('keeps every series colour distinguishable from the plot surface', () => {
    // Series colours carry lines and markers rather than text, so 3:1 is the
    // bar for non-text contrast.
    for (let i = 1; i <= 6; i++) {
      const ratio = contrastRatio(light[`--series-${i}`], LIGHT_SURFACE)
      expect(ratio, `--series-${i} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })
})
