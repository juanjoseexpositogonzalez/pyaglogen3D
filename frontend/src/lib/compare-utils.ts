/**
 * Utilities for the multi-aggregate Compare page.
 *
 * Keeps three pure concerns in one module:
 *   - URL parsing (`?sims=a,b,c` → deduped/capped list of ids)
 *   - Deterministic color assignment (stable across refreshes and URL reorders)
 *   - Responsive grid layout mapping (N ∈ [2..9] → cols/rows)
 *
 * These are intentionally framework-free (no React, no next/navigation) so
 * they can be unit-tested trivially and reused from server components if
 * needed later.
 */
export const MAX_COMPARE_SIMS = 9

/**
 * Shape-minimal sim for display-name derivation. Accepts any object that
 * has `id` and `algorithm`, with an optional `name`. This avoids pulling
 * the full `Simulation` type into every place that just needs a label.
 */
export interface NamableSim {
  id: string
  algorithm: string
  name?: string | null
}

/**
 * Derive a human-readable display name for a simulation.
 *
 * Order of precedence:
 *   1. `sim.name` (trimmed) — user-assigned at create time, or
 *      auto-generated server-side via `generate_simulation_name()`.
 *   2. `"ALGO · <8-char id prefix>"` — fallback for legacy records
 *      that predate the `name` field on the backend model.
 *
 * Kept framework-free so it can be unit-tested without a DOM.
 */
export function deriveSimName(sim: NamableSim): string {
  const trimmed = sim.name?.trim()
  if (trimmed) return trimmed
  return `${sim.algorithm.toUpperCase()} · ${sim.id.slice(0, 8)}`
}

/**
 * Deterministic palette used for sim identity across the Compare page
 * (viewer border tint, overlay particle color, metrics table header dot,
 * Rg-evolution chart series color).
 *
 * These are the Tableau10 colors from `d3-scale-chromatic`. Inlined
 * deliberately: adding a runtime dependency for nine hex strings is
 * unjustified. See design.md §"Color palette".
 */
export const COMPARE_PALETTE = [
  '#4E79A7',
  '#F28E2B',
  '#E15759',
  '#76B7B2',
  '#59A14F',
  '#EDC948',
  '#B07AA1',
  '#FF9DA7',
  '#9C755F',
] as const

export interface CompareGridLayout {
  cols: number
  rows: number
}

export interface ParseCompareSimsResult {
  /** Deduplicated ids, in original order, capped at MAX_COMPARE_SIMS. */
  ids: string[]
  /** True when the raw input contained more than MAX_COMPARE_SIMS valid ids. */
  truncated: boolean
}

/**
 * Parse the `?sims=` query param.
 *
 * Accepts either a comma-separated string (Next.js `searchParams.get("sims")`
 * style) or the raw array form (Next.js app router with repeated keys).
 * Trims whitespace per entry, drops empties, dedupes (preserving first
 * occurrence), and caps the result to `MAX_COMPARE_SIMS`.
 *
 * The `truncated` flag is set when the *input* had more than
 * `MAX_COMPARE_SIMS` valid ids — consumers use it to render the truncation
 * warning required by R10.
 */
export function parseCompareSimsParam(
  raw: string | string[] | null | undefined,
): ParseCompareSimsResult {
  if (raw === null || raw === undefined) {
    return { ids: [], truncated: false }
  }

  // Normalize to a single flat list of raw tokens.
  const tokens: string[] = Array.isArray(raw)
    ? raw.flatMap((chunk) => chunk.split(','))
    : raw.split(',')

  const seen = new Set<string>()
  const deduped: string[] = []
  for (const tok of tokens) {
    const id = tok.trim()
    if (id.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    deduped.push(id)
  }

  const truncated = deduped.length > MAX_COMPARE_SIMS
  const ids = truncated ? deduped.slice(0, MAX_COMPARE_SIMS) : deduped

  return { ids, truncated }
}

/**
 * Assign a palette color to each simulation id, deterministically.
 *
 * The assignment is stable across refreshes and independent of the URL
 * order: we sort the ids lexicographically and map index → palette color.
 * If more ids than palette entries are provided, the palette wraps
 * (modulo) — the cap-at-9 rule is enforced elsewhere (in
 * `parseCompareSimsParam`), but wrapping keeps this function total.
 *
 * Returns a record keyed by the original ids.
 */
export function getCompareColorPalette(ids: string[]): Record<string, string> {
  const sorted = [...ids].sort()
  const map: Record<string, string> = {}
  for (let i = 0; i < sorted.length; i++) {
    map[sorted[i]] = COMPARE_PALETTE[i % COMPARE_PALETTE.length]
  }
  return map
}

/**
 * Return the CSS grid dimensions for a given number of simulations.
 *
 * Mapping (from spec R2):
 *   N=2 → 2×1  (one row of two)
 *   N=3 → 3×1  (one row of three)
 *   N=4 → 2×2
 *   N=5, 6 → 3×2
 *   N=7, 8, 9 → 3×3
 *
 * For N < 2 (which should never reach here in the Compare flow — the
 * route renders an empty state) we fall back to 1×1 so callers can still
 * render *something* without crashing. The route-level empty state is the
 * real user-visible guard.
 */
export function getCompareGridLayout(n: number): CompareGridLayout {
  if (n <= 1) return { cols: 1, rows: 1 }
  if (n === 2) return { cols: 2, rows: 1 }
  if (n === 3) return { cols: 3, rows: 1 }
  if (n === 4) return { cols: 2, rows: 2 }
  if (n <= 6) return { cols: 3, rows: 2 }
  // N >= 7 → 3×3. Values beyond 9 fall into the same bucket; the cap is
  // enforced by parseCompareSimsParam before the layout is computed.
  return { cols: 3, rows: 3 }
}
