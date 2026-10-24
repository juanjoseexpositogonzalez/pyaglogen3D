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

/** An explicit choice wins; `system` defers to what the environment reports. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

/** Apply the resolved theme to the document element. */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/**
 * The script that runs before the first paint, as a string.
 *
 * It is inlined into the document head, so it cannot import anything, so it
 * re-implements the read of the persisted preference. It is the only reader:
 * a TypeScript twin of this parse would be code nothing calls, so the script
 * is exercised directly, by running it against a fake storage.
 *
 * The outer catch is for storage being unavailable at all, which leaves no
 * preference to honour; a corrupted entry is handled closer in, so that it
 * still defers to the system setting.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem('${THEME_STORAGE_KEY}');
    var preference = 'system';
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        var value = parsed && parsed.state && parsed.state.preference;
        if (value === 'light' || value === 'dark' || value === 'system') preference = value;
      } catch (e) {
        // A corrupted entry falls through to the system setting. Forcing
        // light here would flash the wrong theme at a dark-mode visitor.
      }
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
    document.documentElement.style.colorScheme = 'light';
  }
})();
`.trim()
