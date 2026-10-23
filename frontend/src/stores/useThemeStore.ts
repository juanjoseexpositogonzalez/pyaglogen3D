'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_PREFERENCE,
  THEME_STORAGE_KEY,
  applyTheme,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'

/**
 * The theme preference, persisted the same way the viewer settings are.
 *
 * Reusing zustand with `persist` rather than opening a second persistence
 * mechanism: `viewerStore` already set the precedent, and two mechanisms would
 * mean two places to look when a preference fails to survive a reload.
 *
 * The store does not decide the initial theme. The inline bootstrap script has
 * already written `data-theme` before the first paint, and the store reads
 * that back, so hydration never disagrees with what is on screen.
 */
interface ThemeState {
  preference: ThemePreference
  /** What is actually on screen, after resolving `system`. */
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  /** Re-resolve from the environment; used by the media-query listener. */
  syncFromSystem: (systemPrefersDark: boolean) => void
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function currentFromDocument(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: DEFAULT_PREFERENCE,
      resolved: currentFromDocument(),

      setPreference: (preference) => {
        const resolved = resolveTheme(preference, systemPrefersDark())
        if (typeof document !== 'undefined') applyTheme(document.documentElement, resolved)
        set({ preference, resolved })
      },

      syncFromSystem: (prefersDark) => {
        // Only `system` follows the environment; an explicit choice stands.
        if (get().preference !== 'system') return
        const resolved = resolveTheme('system', prefersDark)
        if (typeof document !== 'undefined') applyTheme(document.documentElement, resolved)
        set({ resolved })
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      // Only the preference is persisted; `resolved` is derived and would go
      // stale the moment the system preference changed between visits.
      partialize: (state) => ({ preference: state.preference }),
    },
  ),
)

/**
 * Keep the store in step with the environment and with the attribute the
 * bootstrap script wrote. Mounted once, by the provider.
 */
export function useThemeSync(): void {
  const syncFromSystem = useThemeStore((s) => s.syncFromSystem)

  useEffect(() => {
    // Reconcile with whatever the inline script resolved before paint.
    useThemeStore.setState({ resolved: currentFromDocument() })

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => syncFromSystem(event.matches)

    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [syncFromSystem])
}
