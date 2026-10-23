/**
 * The theme store had no tests at all, so R2's "MUST persist an explicit
 * choice across sessions" had no automated evidence: only the pure resolver
 * and the inline script string were covered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY } from '@/lib/theme'
import { useThemeStore } from '../useThemeStore'

function setSystemPrefersDark(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: dark && query.includes('dark'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = ''
  useThemeStore.setState({ preference: 'system', resolved: 'light' })
  setSystemPrefersDark(false)
})

afterEach(() => {
  // jsdom has no matchMedia of its own; leaving a stub behind would make an
  // unrelated test pass or fail depending on execution order.
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('useThemeStore', () => {
  it('applies an explicit choice to the document', () => {
    useThemeStore.getState().setPreference('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(useThemeStore.getState().resolved).toBe('dark')
  })

  it('lets an explicit choice override the operating system', () => {
    setSystemPrefersDark(true)
    useThemeStore.getState().setPreference('light')

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(useThemeStore.getState().resolved).toBe('light')
  })

  it('follows the system while the preference is system', () => {
    useThemeStore.getState().setPreference('system')
    useThemeStore.getState().syncFromSystem(true)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(useThemeStore.getState().resolved).toBe('dark')
  })

  it('ignores the system once a choice has been made', () => {
    // This is the whole point of the preference: a later OS change must not
    // undo what the user asked for.
    useThemeStore.getState().setPreference('light')
    useThemeStore.getState().syncFromSystem(true)

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(useThemeStore.getState().resolved).toBe('light')
  })

  it('persists the choice under the key the inline script reads', () => {
    // R2: the choice must survive a reload. The inline script resolves the
    // theme before paint from this exact key, so a mismatch would silently
    // reintroduce the flash.
    useThemeStore.getState().setPreference('dark')

    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    expect(raw, `nothing stored under ${THEME_STORAGE_KEY}`).toBeTruthy()
    expect(JSON.parse(raw as string).state.preference).toBe('dark')
  })

  it('persists the preference only, not the resolved theme', () => {
    // `resolved` is derived and would go stale if the system preference
    // changed between visits.
    useThemeStore.getState().setPreference('system')
    useThemeStore.getState().syncFromSystem(true)

    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) as string)
    expect(stored.state.preference).toBe('system')
    expect(stored.state.resolved).toBeUndefined()
  })
})
