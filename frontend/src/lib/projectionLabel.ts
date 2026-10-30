import { formatParameterValue } from '@/lib/formatParameterValue'

/**
 * The label the projection export panel shows for a batch child.
 *
 * `Object.entries(parameters)` was wrong twice over: the child carries a
 * distribution under both of its names - the grid-facing one and the engine one,
 * which R13.10 requires - so the same magnitude appeared twice, and those values
 * are objects, so templating them printed `[object Object]`. Both measured in
 * #191.
 *
 * Two rounds of review found that the naive fixes reopen the same door from
 * other directions, because `base_parameters` is the study as it was SENT and
 * `parameters` is the child as it was STORED, where R13.10 has completed the
 * aliases. So both sides are canonicalised first: one entry per magnitude,
 * always under the name the user typed.
 */

/** The two names of one magnitude; the first is the one the grid exposes. */
const ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['kf_distribution', 'target_kf_distribution'],
  ['particle_radius_config', 'dpo_distribution'],
]

/** One entry per magnitude: the stored engine copy is dropped, not shown. */
function canonicalise(params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params }
  for (const [gridName, engineName] of ALIAS_PAIRS) {
    if (gridName in out && engineName in out) delete out[engineName]
  }
  return out
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function simulationLabel(
  parameters: Record<string, unknown>,
  parameterGrid: Record<string, unknown>,
  baseParameters: Record<string, unknown> = {},
): string {
  const shown = canonicalise(parameters)
  const base = canonicalise(baseParameters)

  const gridKeys = Object.keys(parameterGrid)
  // An empty grid is reachable - the serializer defaults an absent grid to `{}`
  // and the form lets every variation be removed - and sourcing only from the
  // grid left the row reading just "Sim ". The fallback takes the canonical
  // keys, so it cannot reintroduce the duplicated magnitude.
  const columns = gridKeys.length ? gridKeys : Object.keys(shown)

  // The limiting-case children are not built from the grid: their variation
  // lives in the parameters they override. A judge measured that reading the
  // grid alone collapsed eleven children into three identical labels, so
  // anything the child has and the base does not is part of its identity.
  const varied = Object.keys(shown).filter(
    (key) => !columns.includes(key) && !sameValue(shown[key], base[key]),
  )

  const entries = [...columns, ...varied].map(
    (key) => `${key}=${formatParameterValue(shown[key])}`,
  )
  return `Sim ${entries.join(', ')}`
}
