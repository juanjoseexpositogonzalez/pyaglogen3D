/**
 * Which batch studies ran before sintering reached the engine, and what can
 * be done about each one.
 *
 * A study configured with `normal` sintering declared a mean that never
 * arrived at the calculation: it was stored under a key no consumer read, and
 * the engine used its 1.0 default, which means no sintering. The run finished
 * without a single error, so nothing on screen said otherwise.
 *
 * Measured with the same seed and size: radius of gyration 6.83 unsintered
 * against 5.48 sintered. These results do not merely carry more uncertainty —
 * they describe a different population from the one their configuration
 * claims.
 */
import { consumesSintering, toSinteringConfig, type SinteringConfig } from './sinteringShape'
import type {
  CreateParametricStudyInput,
  DistributionValue,
  SimulationAlgorithm,
} from './types'

/**
 * When the fix reached the deployed application.
 *
 * Deliberately the release to `main` (commit f2c8af4), not the merge to
 * `develop` on 2026-10-25: users ran against what was deployed, so a cutoff
 * taken from the development branch would leave a week of studies unflagged.
 *
 * And the instant of that merge rather than the start of its day: midnight
 * would clear everything run that morning against the old backend, which is
 * under-reporting — the one direction this must never fail in.
 */
export const SINTERING_FIX_DEPLOYED_AT = '2026-10-26T15:03:00Z'

/** Sintering kinds whose value did reach the engine, so they are unaffected. */
const KINDS_THAT_APPLIED = new Set(['fixed', 'uniform'])

/**
 * The three spellings a stored configuration can use for its kind.
 *
 * The selector once sent `mode`, the API speaks `distribution_type`, and
 * `type` appears in stored rows as well. A criterion that knows only one of
 * them quietly clears studies it simply cannot read — which is worse than not
 * checking, because it looks like an answer.
 */
const KIND_KEYS = ['distribution_type', 'type', 'mode'] as const

export type SinteringClassification =
  /** Declared sintering that never reached the engine. The corrected defect. */
  | 'affected'
  /** The algorithm never consumed sintering: the expectation was always wrong. */
  | 'never-consumed'
  /** Declared nothing, or declared a kind that did apply. */
  | 'unaffected'

interface ChildLike {
  parameters?: Record<string, unknown> | null
}

interface StudyLike {
  created_at?: string | null
  sintering_config?: unknown
  base_parameters?: Record<string, unknown> | null
  parameter_grid?: Record<string, unknown> | null
  base_algorithm?: SimulationAlgorithm
}

/**
 * Every place a study can declare sintering.
 *
 * The study's own `sintering_config` is nearly vestigial: the form has always
 * put the distribution into `parameter_grid.sintering_config`, so reading
 * only the study field flagged nothing created through the interface — and an
 * unmarked study asserts that it is fine.
 */
function declaredConfigs(study: StudyLike): unknown[] {
  const fromGrid = study.parameter_grid?.sintering_config
  return [
    study.sintering_config,
    study.base_parameters?.sintering_config,
    ...(Array.isArray(fromGrid) ? fromGrid : [fromGrid]),
  ].filter((config) => config != null)
}

/**
 * Spellings that belong to the selector, never to the API.
 *
 * Until 2026-10-24 the form sent these untranslated. The backend looked for
 * `distribution_type`, defaulted to its fixed branch, found no `coefficient`
 * and ran at 1.0 — no sintering, whatever kind the config claimed, and
 * without writing `sintering_mean` either. So this era is invisible to the
 * exact criterion and has to be caught here.
 */
function usesSelectorSpelling(config: Record<string, unknown>): boolean {
  return 'mode' in config || 'value' in config
}

/** Did this one declaration fail to reach the engine? */
function neverApplied(config: unknown): boolean {
  if (config == null || typeof config !== 'object') return false
  const record = config as Record<string, unknown>
  if (usesSelectorSpelling(record)) return true

  const kind = kindOf(record)
  return kind !== null && !KINDS_THAT_APPLIED.has(kind)
}

function kindOf(config: unknown): string | null {
  if (config == null || typeof config !== 'object') return null
  for (const key of KIND_KEYS) {
    const value = (config as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return null
}

function createdBeforeFix(createdAt: string | null | undefined): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN
  // Stored JSON guarantees nothing. An unreadable date must not decide the
  // question either way, and must never take down the list it appears in.
  if (Number.isNaN(created)) return false
  return created < Date.parse(SINTERING_FIX_DEPLOYED_AT)
}

/**
 * The authoritative test, available wherever a study's children are loaded.
 *
 * `sintering_mean` is the key the old code wrote and nothing read. Production
 * no longer writes it, so finding it is a fact about this data rather than an
 * inference from a date.
 */
export function studyChildrenRanWithoutSintering(children: readonly ChildLike[]): boolean {
  return children.some(
    (child) => child.parameters != null && 'sintering_mean' in child.parameters,
  )
}

/**
 * The cheap test, for lists where only the study itself is available.
 *
 * It may over-report and must never under-report: a study wrongly marked
 * costs a reader one click to find out otherwise, while one wrongly cleared
 * leaves them comparing populations that are not comparable.
 */
export function studyMayHaveRunWithoutSintering(study: StudyLike): boolean {
  if (!declaredConfigs(study).some(neverApplied)) return false
  return createdBeforeFix(study.created_at)
}

/**
 * Separates a corrected defect from an expectation that never held.
 *
 * `fracval`, `gcca`, `box_rfa` and `imported` consume no sintering at all, so
 * their studies did not lose it to the defect — it was never going to apply.
 * Showing them the same warning would merge a bug that was fixed with a
 * misunderstanding that still stands, and only one of those can be acted on.
 */
/**
 * Whether the engine reads sintering for this algorithm at all.
 *
 * Deliberately not `consumesSintering`, which answers the form's question —
 * "does it take the whole distribution?" — and therefore excludes `limiting`.
 * `limiting` does read `sintering_coeff`, so its studies were affected by the
 * defect like any other, and telling their owner that sintering never applies
 * would instruct them not to act on a result that is wrong.
 */
function engineReadsSintering(algorithm: SimulationAlgorithm): boolean {
  return consumesSintering(algorithm) || algorithm === 'limiting'
}

export function classifySintering(study: StudyLike): SinteringClassification {
  if (!studyMayHaveRunWithoutSintering(study)) return 'unaffected'
  if (study.base_algorithm && !engineReadsSintering(study.base_algorithm)) return 'never-consumed'
  return 'affected'
}

/**
 * The configuration a relaunch may send, or `null` when none can be.
 *
 * Re-sending what is stored fails: measured against the API, `{type: …}` and
 * `{mode: …}` are both rejected, and a `normal` config without `std` is too —
 * old rows can omit it because nothing read it. On a page with no error
 * handling a rejected request is an invisible dead button, so the refusal
 * happens here instead.
 */
export function relaunchConfigFor(study: StudyLike): SinteringConfig | null {
  if (classifySintering(study) !== 'affected') return null

  const config = declaredConfigs(study).find(
    (candidate) => candidate != null && typeof candidate === 'object',
  ) as Record<string, unknown> | undefined
  if (!config) return null
  const kind = kindOf(config)
  const numberAt = (key: string): number | null => {
    const value = config[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  if (kind !== 'normal') return null

  const mean = numberAt('mean')
  if (mean === null) return null

  // `limiting` reads a flat coefficient and ignores type, min, max and std,
  // so the distribution shape is rejected for it. Its relaunch carries the
  // declared mean as that coefficient.
  if (study.base_algorithm === 'limiting') {
    return { distribution_type: 'fixed', coefficient: mean }
  }

  const std = numberAt('std')
  return std !== null ? { distribution_type: 'normal', mean, std } : null
}

/**
 * Translate one stored grid entry into the shape the API accepts, or `null`
 * when it cannot be translated.
 *
 * Old grids carry the selector's own vocabulary, which the API rejects with
 * 400 — invisible on a page with no error handling.
 */
function normaliseGridEntry(entry: unknown): SinteringConfig | null {
  if (entry == null || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const kind = kindOf(record)
  if (kind === null) return null

  const num = (key: string): number | null => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  if ('distribution_type' in record) {
    // Already the API's shape; trust it only if it carries what it needs.
    if (kind === 'normal') {
      const mean = num('mean')
      const std = num('std')
      return mean !== null && std !== null ? { distribution_type: 'normal', mean, std } : null
    }
    if (kind === 'fixed') {
      const coefficient = num('coefficient')
      return coefficient !== null ? { distribution_type: 'fixed', coefficient } : null
    }
    const min = num('min')
    const max = num('max')
    return min !== null && max !== null ? { distribution_type: 'uniform', min, max } : null
  }

  // The selector's spelling. `toSinteringConfig` is the one translation, and
  // reusing it keeps this from becoming a second, divergent copy.
  if (kind === 'normal') {
    const mean = num('mean')
    const std = num('std')
    if (mean === null || std === null) return null
    return toSinteringConfig({ mode: 'normal', mean, std } as DistributionValue)
  }
  if (kind === 'fixed') {
    const value = num('value') ?? num('coefficient')
    if (value === null) return null
    return toSinteringConfig({ mode: 'fixed', value } as DistributionValue)
  }
  const min = num('min')
  const max = num('max')
  if (min === null || max === null) return null
  return toSinteringConfig({ mode: 'uniform', min, max } as DistributionValue)
}

type RelaunchableStudy = StudyLike & {
  name?: string
  description?: string
  base_parameters?: Record<string, unknown> | null
  parameter_grid?: Record<string, unknown> | null
  seeds_per_combination?: number
  include_box_counting?: boolean
  box_counting_params?: unknown
  include_limiting_cases?: boolean
  limiting_cases_config?: Record<string, unknown>
}

/**
 * Everything a relaunch has to send, or `null` when it cannot be built.
 *
 * Copying only the obvious fields produces a study that is not comparable
 * with the one it replaces — which is the entire point of relaunching. The
 * grid is normalised here too: refusing in the client beats a 400 the page
 * cannot show.
 */
export function relaunchPayloadFor(
  study: RelaunchableStudy,
  sintering_config: SinteringConfig,
): CreateParametricStudyInput | null {
  const grid: Record<string, unknown[]> = {}
  for (const [key, value] of Object.entries(study.parameter_grid ?? {})) {
    const entries = Array.isArray(value) ? value : [value]
    if (key !== 'sintering_config') {
      grid[key] = entries
      continue
    }
    const normalised = entries.map(normaliseGridEntry)
    if (normalised.some((entry) => entry === null)) return null
    grid[key] = normalised as SinteringConfig[]
  }

  return {
    name: `${study.name ?? 'Study'} (relaunched with sintering)`,
    description: study.description,
    base_algorithm: study.base_algorithm as SimulationAlgorithm,
    base_parameters: study.base_parameters ?? {},
    parameter_grid: grid,
    seeds_per_combination: study.seeds_per_combination,
    include_box_counting: study.include_box_counting,
    box_counting_params: study.box_counting_params as CreateParametricStudyInput['box_counting_params'],
    include_limiting_cases: study.include_limiting_cases,
    limiting_cases_config: study.limiting_cases_config,
    sintering_config,
  }
}
