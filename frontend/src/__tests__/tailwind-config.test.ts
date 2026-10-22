/**
 * `tailwind.config.ts` derives from the tokens in `globals.css` and restates
 * none of them.
 *
 * This file lives under `src/` on purpose: `vitest.config.ts` only collects
 * `src/**`, so a test placed at the repository's `frontend/__tests__/` would
 * never run and would pass vacuously.
 *
 * Covers design-system-foundation R1-S1.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8').replace(/\r/g, '')

/** The file without comments: prose may legitimately mention a colour. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('tailwind config', () => {
  it('contains no hexadecimal colour literal', () => {
    const hits = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hits, `literal colours found: ${hits.join(', ')}`).toEqual([])
  })

  it('contains no rgb() or hsl() literal value', () => {
    // `hsl(var(--token))` is derivation, not a literal; anything with digits
    // inside the function is a restated value.
    const hits = code.match(/(?:rgba?|hsla?)\(\s*[\d.]/g) ?? []
    expect(hits, `literal colour functions found: ${hits.join(', ')}`).toEqual([])
  })

  it('resolves every colour through a custom property', () => {
    const colourBlock = code.slice(code.indexOf('colors:'), code.indexOf('backgroundImage:'))
    // Only quoted strings that sit on the value side of a colon are values;
    // a bare `'on-dark':` is a key and must not be asserted against.
    const values = (colourBlock.match(/:\s*'[^']+'/g) ?? []).map((m) =>
      m.slice(m.indexOf("'")),
    )
    expect(values.length).toBeGreaterThan(20)
    values.forEach((value) => {
      expect(value, `${value} does not derive from a token`).toMatch(/var\(--/)
    })
  })

  it('anchors darkMode to the data-theme attribute, not to media', () => {
    // Undeclared means `media` in Tailwind 3.x, under which the 38 dark:
    // utilities in src/ follow the operating system and contradict an
    // explicit user choice. Covers design-system-foundation R2-S1.
    expect(code).toMatch(/darkMode:\s*\[\s*'selector'\s*,\s*'\[data-theme="dark"\]'\s*\]/)
  })

  it('keeps theme.extend so the default palette survives', () => {
    // hemisphere-grid-viz fixes dot states by Tailwind palette name
    // (gray-400, blue-500, blue-700); replacing `theme` would delete them.
    expect(code).toMatch(/theme:\s*\{\s*extend:/)
  })
})
