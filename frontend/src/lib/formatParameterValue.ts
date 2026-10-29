/**
 * Render a parameter value the way a results view has to show it.
 *
 * R13.3 asks that a results column show the configuration rather than an empty
 * cell. Both batch views are columns of `parameters`, and a distribution key
 * holds an object: templating it printed `[object Object]` in one view and
 * `String(...)` printed the same in the other, so the one thing the column
 * exists to say - what this child was configured with - was a placeholder.
 *
 * An absent value reads as an em dash instead of `undefined` or `-`: the same
 * convention `Num` uses for a missing number.
 */
export function formatParameterValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
