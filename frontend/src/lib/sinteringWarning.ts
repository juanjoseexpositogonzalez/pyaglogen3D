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
import { consumesSintering, type SinteringConfig } from './sinteringShape'
import type { SimulationAlgorithm } from './types'

/**
 * When the fix reached the deployed application.
 *
 * Deliberately the release to `main`, not the merge to `develop` on
 * 2026-10-25: users ran against what was deployed. A cutoff taken from the
 * development branch would leave every study from that week unflagged.
 */
export const SINTERING_FIX_DEPLOYED_AT = '2026-10-26T00:00:00Z'

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
  base_algorithm?: SimulationAlgorithm
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
  const kind = kindOf(study.sintering_config)
  if (kind === null || KINDS_THAT_APPLIED.has(kind)) return false
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
export function classifySintering(study: StudyLike): SinteringClassification {
  if (!studyMayHaveRunWithoutSintering(study)) return 'unaffected'
  if (study.base_algorithm && !consumesSintering(study.base_algorithm)) return 'never-consumed'
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

  const config = study.sintering_config as Record<string, unknown>
  const kind = kindOf(config)
  const numberAt = (key: string): number | null => {
    const value = config[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  if (kind === 'normal') {
    const mean = numberAt('mean')
    const std = numberAt('std')
    return mean !== null && std !== null ? { distribution_type: 'normal', mean, std } : null
  }

  return null
}
