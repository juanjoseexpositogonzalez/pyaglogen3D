/**
 * Theme resolution, as pure functions.
 *
 * Kept free of React and of `window.matchMedia` on purpose. jsdom 23 does not
 * provide `matchMedia` and `src/test/setup.ts` stubs nothing, so a resolver
 * that reached for it directly could not be tested; here the system preference
 * arrives as an argument and the caller is the one that observes it.
 *
 * The same logic runs twice: once inline in the document head, before the
 * first paint, and once in the store. They must agree, so they share this
 * module and the storage key below.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/**
 * The key zustand's `persist` writes, and the shape it writes it in:
 * `{"state":{…},"version":n}`. The inline script reads the same key, so a
 * naive `localStorage.getItem('theme')` would silently miss it and reintroduce
 * the flash of the wrong theme.
 */
export const THEME_STORAGE_KEY = 'theme-preference'

export const DEFAULT_PREFERENCE: ThemePreference = 'system'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** An explicit choice wins; `system` defers to what the environment reports. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

/** Read the preference out of a persisted zustand payload. */
export function readPersistedPreference(raw: string | null): ThemePreference {
  if (!raw) return DEFAULT_PREFERENCE
  try {
    const parsed = JSON.parse(raw) as { state?: { preference?: unknown } }
    const value = parsed?.state?.preference
    return isThemePreference(value) ? value : DEFAULT_PREFERENCE
  } catch {
    // A corrupted entry must not take the application down with it.
    return DEFAULT_PREFERENCE
  }
}

/** Apply the resolved theme to the document element. */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/**
 * The script that runs before the first paint, as a string.
 *
 * It is inlined into the document head, so it cannot import anything; the
 * logic above is duplicated here deliberately and the two are kept in step by
 * a test that exercises both against the same cases.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem('${THEME_STORAGE_KEY}');
    var preference = 'system';
    if (raw) {
      var parsed = JSON.parse(raw);
      var value = parsed && parsed.state && parsed.state.preference;
      if (value === 'light' || value === 'dark' || value === 'system') preference = value;
    }
    var dark =
      preference === 'dark' ||
      (preference === 'system' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    var theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`.trim()
