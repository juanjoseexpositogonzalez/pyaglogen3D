import { formatParameterValue } from '@/lib/formatParameterValue'

/**
 * The label the projection export panel shows for a batch child.
 *
 * `Object.entries(parameters)` was wrong twice over: the child carries a
 * distribution under both of its names - the grid-facing one and the engine one,
 * which R13.10 requires - so the same magnitude appeared twice, and those
 * values are objects, so templating them printed `[object Object]`. Both
 * measured in #191.
 *
 * The columns come from `parameter_grid.keys()`, like the other four result
 * views, and the value is rendered with the same helper they use. A key the grid
 * varies but the child lacks reads as the em dash, not as `undefined`.
 */
export function simulationLabel(
  parameters: Record<string, unknown>,
  parameterGrid: Record<string, unknown>,
): string {
  const entries = Object.keys(parameterGrid).map(
    (key) => `${key}=${formatParameterValue(parameters[key])}`,
  )
  return `Sim ${entries.join(', ')}`
}
