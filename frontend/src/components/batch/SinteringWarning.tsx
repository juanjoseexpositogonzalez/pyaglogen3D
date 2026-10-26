'use client'

import { Callout } from '@/components/kit/Callout'
import { Button } from '@/components/ui/button'
import {
  classifySintering,
  relaunchConfigFor,
  studyChildrenRanWithoutSintering,
} from '@/lib/sinteringWarning'
import type { SinteringConfig } from '@/lib/sinteringShape'
import type { SimulationAlgorithm } from '@/lib/types'

interface StudyLike {
  created_at?: string | null
  sintering_config?: unknown
  base_algorithm?: SimulationAlgorithm
  total_simulations?: number
}

export interface SinteringWarningProps {
  study: StudyLike
  /** The study's children, when loaded. They decide over the date. */
  childResults?: ReadonlyArray<{ parameters?: Record<string, unknown> | null }>
  onRelaunch: (config: SinteringConfig) => void
  isRelaunching?: boolean
}

/**
 * Tells a reader that the numbers beside this warning do not describe the
 * configuration beside them.
 *
 * Measured with the same seed and size, radius of gyration came out 6.83
 * without sintering against 5.48 with it. That is not extra uncertainty: it
 * is a different population, so anyone who compared a "sintered" study with
 * an unsintered one compared two unsintered ones.
 */
export function SinteringWarning({
  study,
  childResults,
  onRelaunch,
  isRelaunching = false,
}: SinteringWarningProps) {
  // Children are a fact about the data; the date is an inference from which
  // branch was deployed. When both are available, the fact wins.
  const childrenSaySo = childResults ? studyChildrenRanWithoutSintering(childResults) : false
  const classification = classifySintering(study)

  if (!childrenSaySo && classification === 'unaffected') return null

  if (classification === 'never-consumed') {
    return (
      <div role="status" aria-live="polite">
        <Callout tone="warning" title="This algorithm never applies sintering">
          The study declares a sintering configuration, but{' '}
          <strong>{study.base_algorithm}</strong> does not read it — it never did. The results
          below are what this algorithm always produces; relaunching would not change them.
        </Callout>
      </div>
    )
  }

  const relaunchConfig = relaunchConfigFor(study)
  const simulations = study.total_simulations ?? 0

  return (
    <div role="status" aria-live="polite">
      <Callout tone="warning" title="These results ran without sintering">
        This study declared sintering, but the value never reached the engine: it was stored
        under a key nothing read, and the calculation used its default of 1.0, which means no
        sintering at all. The run finished without an error, so nothing said otherwise.
        <br />
        <br />
        Measured with the same seed and size, radius of gyration comes out <strong>6.83</strong>{' '}
        unsintered against <strong>5.48</strong> sintered. These results describe a different
        population from the one configured above.
        {relaunchConfig ? (
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              disabled={isRelaunching}
              onClick={() => onRelaunch(relaunchConfig)}
            >
              {isRelaunching
                ? 'Starting…'
                : `Relaunch ${simulations} simulations with the declared configuration`}
            </Button>
            <p className="hint mt-1.5">
              Creates a new study and leaves this one untouched, so the evidence of what
              happened survives.
            </p>
          </div>
        ) : (
          <p className="mt-3">
            This study <strong>cannot be relaunched automatically</strong>: its stored
            configuration is missing values the API now requires, because nothing used to read
            them. Recreating it by hand with the same configuration produces the intended result.
          </p>
        )}
      </Callout>
    </div>
  )
}
