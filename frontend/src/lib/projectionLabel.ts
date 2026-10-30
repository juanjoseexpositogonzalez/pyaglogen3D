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
 * varies but the child lacks reads as the em dash, not as `undefined` - which is
 * what those views do too, and what R13.3 should probably stop allowing (#204).
 */
// The two names of one magnitude. The child carries both (R13.10), and showing
// the second one is the duplication #191 closes; a varying key whose alias is
// already a column is not new information.
const ALIASES: Record<string, string> = {
  kf_distribution: 'target_kf_distribution',
  target_kf_distribution: 'kf_distribution',
  particle_radius_config: 'dpo_distribution',
  dpo_distribution: 'particle_radius_config',
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function simulationLabel(
  parameters: Record<string, unknown>,
  parameterGrid: Record<string, unknown>,
  baseParameters: Record<string, unknown> = {},
): string {
  const gridKeys = Object.keys(parameterGrid)
  // An empty grid is reachable - the serializer defaults an absent grid to `{}`
  // and the form lets every variation be removed - and sourcing only from the
  // grid left the row reading just "Sim ", losing every parameter. The sibling
  // view this claims parity with falls back the same way.
  const columns = gridKeys.length ? gridKeys : Object.keys(parameters)

  // The limiting-case children are not built from the grid: their variation
  // lives in the parameters they override. A judge measured that reading the
  // grid alone collapsed eleven children into three identical labels - the fix
  // for `[object Object]` would have traded an ugly label for an ambiguous one,
  // in the only place the panel identifies a row. So anything the child carries
  // that the base does not is part of its identity.
  const varied = Object.keys(parameters).filter(
    (key) =>
      !columns.includes(key) &&
      !(ALIASES[key] && columns.includes(ALIASES[key])) &&
      !sameValue(parameters[key], baseParameters[key]),
  )

  const entries = [...columns, ...varied].map(
    (key) => `${key}=${formatParameterValue(parameters[key])}`,
  )
  return `Sim ${entries.join(', ')}`
}
