/**
 * Covers design-system-foundation R2: an explicit choice wins over the system
 * preference, the system preference is honoured when none was expressed, and
 * the inline bootstrap script resolves the same way the store does.
 *
 * The resolver takes the system preference as an argument rather than reading
 * `window.matchMedia`, which jsdom 23 does not provide and `src/test/setup.ts`
 * does not stub. That is what makes these assertions possible at all.
 */
import { describe, expect, it } from 'vitest'

import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  resolveTheme,
  type ThemePreference,
} from '../theme'

/** The cases both implementations must agree on. */
const CASES: Array<{ preference: ThemePreference; systemDark: boolean; expected: string }> = [
  { preference: 'system', systemDark: true, expected: 'dark' },
  { preference: 'system', systemDark: false, expected: 'light' },
  { preference: 'light', systemDark: true, expected: 'light' },
  { preference: 'dark', systemDark: false, expected: 'dark' },
]

describe('resolveTheme', () => {
  it.each(CASES)(
    'resolves $preference with systemDark=$systemDark to $expected',
    ({ preference, systemDark, expected }) => {
      expect(resolveTheme(preference, systemDark)).toBe(expected)
    },
  )

  it('lets an explicit choice override the operating system', () => {
    // The case that fails when Tailwind's darkMode is left on `media`.
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('writes both the attribute Tailwind keys on and the colour scheme', () => {
    const root = document.createElement('html')
    applyTheme(root, 'dark')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })
})

describe('the inline bootstrap script', () => {
  /**
   * Run the script string against a simulated document and storage. This is
   * the only way to test "before the first paint": jsdom performs no paint,
   * so the guarantee is expressed as "the script writes the right attribute
   * given this input", and the visual absence of a flash stays a manual check.
   */
  function runScript(stored: string | null, systemDark: boolean): string | undefined {
    const root = document.createElement('html')
    const fakeDocument = { documentElement: root }
    const fakeWindow = {
      matchMedia: (query: string) => ({ matches: systemDark && query.includes('dark') }),
    }
    const fakeStorage = { getItem: () => stored }

    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'localStorage', THEME_BOOTSTRAP_SCRIPT)(
      fakeDocument,
      fakeWindow,
      fakeStorage,
    )
    return root.dataset.theme
  }

  it.each(CASES)(
    'agrees with resolveTheme for $preference / systemDark=$systemDark',
    ({ preference, systemDark, expected }) => {
      const stored = JSON.stringify({ state: { preference }, version: 0 })
      expect(runScript(stored, systemDark)).toBe(expected)
      // Both implementations must stay in step: they are duplicated because
      // the inline script cannot import.
      expect(runScript(stored, systemDark)).toBe(resolveTheme(preference, systemDark))
    },
  )

  it('falls back to light when storage throws', () => {
    const root = document.createElement('html')
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'localStorage', THEME_BOOTSTRAP_SCRIPT)(
      { documentElement: root },
      { matchMedia: undefined },
      {
        getItem: () => {
          throw new Error('denied')
        },
      },
    )
    expect(root.dataset.theme).toBe('light')
  })

  it('reads the shape zustand persist actually writes', () => {
    // A naive getItem('theme') would miss this and reintroduce the flash.
    expect(runScript('{"state":{"preference":"dark"},"version":0}', false)).toBe('dark')
  })

  it('falls back to the system preference when nothing is stored', () => {
    expect(runScript(null, true)).toBe('dark')
    expect(runScript(null, false)).toBe('light')
  })

  it('survives a corrupted entry instead of taking the page down', () => {
    expect(runScript('{not json', true)).toBe('dark')
    expect(runScript('{not json', false)).toBe('light')
  })

  it('ignores a value that is not a preference', () => {
    // Falling through to the system setting, not to a hardcoded theme.
    expect(runScript('{"state":{"preference":"chartreuse"}}', true)).toBe('dark')
    expect(runScript('{"state":{"preference":"chartreuse"}}', false)).toBe('light')
  })

  it('reads the same storage key the store writes', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY)
  })
})
