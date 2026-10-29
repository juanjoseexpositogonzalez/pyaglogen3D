/**
 * Token guarantees for `src/app/globals.css`.
 *
 * These assertions parse the stylesheet as text rather than inspecting a
 * document. PostCSS does not run under vitest, so the sheet imported by
 * `layout.tsx` never reaches the test DOM and `getComputedStyle` would resolve
 * nothing. (jsdom itself resolves custom properties fine when a test injects
 * them, which is how the chart-theme tests work.)
 *
 * No `Map`, no `matchAll`, no spread over an iterator: `tsconfig.json`
 * declares no `target`, so TypeScript assumes ES5 and rejects them, and that
 * file is outside this change's editable surface.
 *
 * Covers design-system-foundation R2-S4 and R3-S1.
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

type Tokens = Record<string, string>

/** Extract the declarations of one top-level block by its selector. */
function blockOf(selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `selector ${selector} not found`).toBeGreaterThan(-1)
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

/** Custom property name to declared value, for one block. */
function tokensOf(selector: string): Tokens {
  const out: Tokens = {}
  const body = blockOf(selector)
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m = re.exec(body)
  while (m !== null) {
    out[m[1]] = m[2].trim()
    m = re.exec(body)
  }
  return out
}

const light = tokensOf(':root')
const dark = tokensOf("[data-theme='dark']")

/** A token carries a colour if its value mentions one in any notation. */
const isColourBearing = (value: string) =>
  /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|^\s*[\d.]+\s+[\d.]+%\s+[\d.]+%\s*$/.test(value)

/** An alias resolves through another token and inherits its theme value. */
const isAlias = (value: string) => /^var\(--[\w-]+\)$/.test(value.trim())

describe('design tokens', () => {
  it('declares both themes', () => {
    expect(Object.keys(light).length).toBeGreaterThan(40)
    expect(Object.keys(dark).length).toBeGreaterThan(30)
  })

  it('gives every colour-bearing token a value in both themes', () => {
    const missing = Object.keys(light).filter(
      (name) => isColourBearing(light[name]) && !isAlias(light[name]) && dark[name] === undefined,
    )
    expect(missing, `tokens without a dark counterpart: ${missing.join(', ')}`).toEqual([])
  })

  it('lets var() aliases inherit instead of redeclaring them', () => {
    // `--chart-N: var(--series-N)` needs no dark block: the source token moves.
    const aliases = Object.keys(light).filter((name) => isAlias(light[name]))
    expect(aliases.length).toBeGreaterThan(0)
    aliases.forEach((name) => expect(dark[name]).toBeUndefined())
  })

  it('declares no empty value in either theme', () => {
    Object.keys(light).forEach((n) => expect(light[n], `${n} is empty`).not.toBe(''))
    Object.keys(dark).forEach((n) => expect(dark[n], `${n} is empty`).not.toBe(''))
  })

  it('keeps semantic and series colours disjoint, in both themes', () => {
    const themes: Array<[string, Tokens]> = [
      ['light', light],
      ['dark', dark],
    ]
    themes.forEach(([label, tokens]) => {
      const series = [1, 2, 3, 4, 5, 6].map((i) => (tokens[`--series-${i}`] || '').toLowerCase())
      expect(series.every(Boolean), `${label}: series ramp incomplete`).toBe(true)
      ;['--success', '--warning', '--danger'].forEach((key) => {
        const value = (tokens[key] || '').toLowerCase()
        expect(value, `${label}: ${key} missing`).toBeTruthy()
        expect(series, `${label}: ${value} is both a semantic and a series colour`).not.toContain(
          value,
        )
      })
    })
  })

  it('keeps the six series colours distinct from each other', () => {
    ;[light, dark].forEach((tokens) => {
      const series = [1, 2, 3, 4, 5, 6].map((i) => (tokens[`--series-${i}`] || '').toLowerCase())
      const unique: string[] = []
      series.forEach((v) => {
        if (unique.indexOf(v) === -1) unique.push(v)
      })
      expect(unique.length).toBe(6)
    })
  })
})
