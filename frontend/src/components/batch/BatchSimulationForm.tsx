'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { DIMERS_ADVICE, needsDimers } from '@/lib/seedTypeAdvice'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, Play } from 'lucide-react'
import { batchSimulationAlgorithmOptions } from '@/lib/simulation-algorithms'
import { DistributionGridInput } from './DistributionGridInput'
import type { SimulationAlgorithm, CreateParametricStudyInput, DistributionValue } from '@/lib/types'
import {
  consumesDistribution,
  consumesSeedType,
  consumesSintering,
  isComplete,
  rejectsVariation,
  toSinteringConfig,
} from '@/lib/sinteringShape'
import { firstDistributionError } from '@/lib/distributionShape'
import { Callout } from '@/components/kit/Callout'
import { Num } from '@/components/kit/Num'
import { Panel } from '@/components/kit/Panel'

const limitingGeometryOptions = [
  { value: 'chain', label: 'Linear Chain (Df=1)' },
  { value: 'plane', label: 'Hexagonal Plane (Df=2)' },
  { value: 'sphere', label: 'Compact Sphere (Df=3)' },
]

// Configuration options per geometry type
const chainConfigOptions = [
  { value: 'lineal', label: 'Lineal - Straight line' },
  { value: 'cruz2d', label: 'Cruz 2D - 2D cross pattern' },
  { value: 'asterisco', label: 'Asterisco - Star pattern' },
  { value: 'cruz3d', label: 'Cruz 3D - 3D cross pattern' },
]

const planeConfigOptions = [
  { value: 'plano', label: 'Plano - Single hexagonal plane' },
  { value: 'dobleplano', label: 'Doble Plano - Two perpendicular planes' },
  { value: 'tripleplano', label: 'Triple Plano - Three planes at 60°' },
]

const sphereConfigOptions = [
  { value: 'cuboctaedro', label: 'Cuboctaedro - Compact 3D structure' },
]

const packingOptions = [
  { value: 'HC', label: 'HC - Hexagonal Compact' },
  { value: 'CS', label: 'CS - Cubic Simple' },
  { value: 'CCC', label: 'CCC - Face-Centered Cubic' },
]

// Get configuration options based on geometry type
function getConfigOptionsForGeometry(geometry: string) {
  switch (geometry) {
    case 'chain': return chainConfigOptions
    case 'plane': return planeConfigOptions
    case 'sphere': return sphereConfigOptions
    default: return chainConfigOptions
  }
}

// Get default configuration for a geometry type
function getDefaultConfigForGeometry(geometry: string) {
  switch (geometry) {
    case 'chain': return 'lineal'
    case 'plane': return 'plano'
    case 'sphere': return 'cuboctaedro'
    default: return 'lineal'
  }
}

type InputMode = 'discrete' | 'range'

// Parameters that use distribution grid or seed_type chips instead of discrete/range
const DISTRIBUTION_PARAMS = new Set(['kf_distribution', 'particle_radius_config', 'sintering_config'])
const SEED_TYPE_PARAM = 'seed_type'
const SEED_TYPE_OPTIONS = ['monomers', 'dimers', 'trimers'] as const

interface ParameterVariation {
  name: string
  inputMode: InputMode
  // Discrete mode
  values: string // Comma-separated values
  // Range mode
  start: string
  end: string
  step: string
  // Distribution grid mode (for kf_distribution, particle_radius_config, sintering_config)
  distributionValues: DistributionValue[]
  // Seed type mode
  seedTypeValues: string[]
}

function parameterOptionsFor(
algorithm: SimulationAlgorithm,
): { value: string; label: string }[] {
  if (algorithm === 'limiting') {
    return [
      { value: 'configuration_type', label: 'Configuration Type' },
      { value: 'n_particles', label: 'Number of Particles' },
      { value: 'sintering_coeff', label: 'Sintering Coefficient' },
      { value: 'packing', label: 'Packing Type (sphere only)' },
    ]
  }

  const options = [
    { value: 'n_particles', label: 'Number of Particles' },
    { value: 'target_df', label: 'Target Df' },
  ]

  if (['dla', 'cca', 'ballistic', 'ballistic_cc'].includes(algorithm)) {
    options.splice(1, 0, { value: 'sticking_probability', label: 'Sticking Probability' })
  }

  if (['tunable', 'tunable_cc', 'fracval', 'gcca'].includes(algorithm)) {
    options.push({ value: 'target_kf', label: 'Target kf' })
  }

  // New batch-CC parameter grid options.
  // R10.8: the two distribution keys are offered only where the worker reads
  // them - `tunable_cc` alone. The other ten accepted them and read nothing,
  // which the backend now refuses, so offering them here invited a 400 the
  // batch page could not display.
  if (consumesDistribution(algorithm)) {
    options.push(
      { value: 'kf_distribution', label: 'kf distribution (normal/uniform/fixed)' },
      { value: 'particle_radius_config', label: 'Particle radius (per-run variation)' },
    )
  }

  // R10.4: only the algorithms whose engine invocation receives sintering.
  // The backend answers 400 for the rest since T4, so offering it here
  // invited a refusal the batch page cannot even display.
  if (consumesSintering(algorithm)) {
    options.push({
      value: 'sintering_config',
      label: 'Sintering coefficient distribution',
    })
  }

  // R10.8, second key: one worker branch reads `seed_type` and the backend
  // refuses it everywhere else (#115, point 14). It sits after sintering, the
  // position it always had; the previous version inserted sintering before it
  // with `splice(options.length - 1, 0, …)`, which only worked while this key
  // was unconditional.
  if (consumesSeedType(algorithm)) {
    options.push({ value: 'seed_type', label: 'Seed type (monomer/dimer/trimer)' })
  }

  return options
}

interface BatchSimulationFormProps {
  onSubmit: (data: CreateParametricStudyInput) => void
  isLoading?: boolean
}

/**
 * Generate array of values from start, end, step
 */
function generateRangeValues(start: number, end: number, step: number): number[] {
  if (step <= 0 || isNaN(start) || isNaN(end) || isNaN(step)) return []
  if (start > end) return []

  const values: number[] = []
  // Use a small epsilon to handle floating point precision
  const epsilon = step / 1000
  for (let v = start; v <= end + epsilon; v += step) {
    // Round to avoid floating point errors (e.g., 0.1 + 0.2 = 0.30000000000000004)
    const rounded = Math.round(v * 1e10) / 1e10
    if (rounded <= end) {
      values.push(rounded)
    }
  }
  return values
}

/**
 * Get the values for a variation based on its input mode
 */
function getVariationValues(variation: ParameterVariation, isInteger: boolean): (number | string)[] {
  if (variation.inputMode === 'range') {
    const start = parseFloat(variation.start)
    const end = parseFloat(variation.end)
    const step = parseFloat(variation.step)
    const values = generateRangeValues(start, end, step)
    return isInteger ? values.map(v => Math.round(v)) : values
  } else {
    // Discrete mode - parse comma-separated values
    return variation.values.split(',').map((v) => {
      const trimmed = v.trim()
      if (!trimmed) return null
      if (isInteger) {
        // #244: `parseInt('20.7')` is 20, so the field said 20.7 and the payload
        // said 20 without a word. A token this parameter cannot take is left as
        // typed - the path a non-numeric token already takes - so the server
        // refuses it by name instead of the form substituting a number nobody
        // asked for. It also reads `1e3` as a thousand instead of as one.
        const num = Number(trimmed)
        return Number.isInteger(num) ? num : trimmed
      }
      const num = parseFloat(trimmed)
      return isNaN(num) ? trimmed : num
    }).filter((v): v is number | string => v !== null)
  }
}

/**
 * Format values for preview display
 */
function formatValuesPreview(values: (number | string)[], maxShow: number = 8): string {
  if (values.length === 0) return 'No values'
  if (values.length <= maxShow) {
    return values.join(', ')
  }
  const shown = values.slice(0, maxShow - 1)
  return `${shown.join(', ')}, ... (${values.length} total)`
}

/**
 * The three states a numeric field can be in (#241, #242).
 *
 * Two states were not enough, and the two defects shared a line of code: a
 * token that does not parse went into the payload as `NaN`, which
 * `JSON.stringify` writes as `null`, and `parseInt(x) || fallback` read a
 * legitimate zero as "nothing typed".
 *
 * - `empty` — the field holds nothing, so the key's own default applies. Only
 *   the keys that have one accept this state.
 * - `invalid` — the field holds something the server cannot take. Nothing is
 *   submitted, and the message names the key.
 * - `value` — a number, zero included. Whether a zero is *allowed* is the key's
 *   own rule, read from the backend rather than assumed:
 *   `ParametricStudySerializer` accepts `seeds_per_combination: 0` (the model
 *   field's only bound is `min_value=0`, and the expansion then creates no
 *   child), while `validate_box_counting_params_dict` refuses
 *   `points_per_sphere` outside [10, 1000] and `precision` outside [8, 21],
 *   zero included.
 */
type NumericReading =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'value'; value: number }

interface NumericRule {
  /** Parsed with `parseInt` (a count) or `parseFloat` (a magnitude). */
  whole: boolean
  /** What an emptied field falls back to. Absent means the field is required. */
  fallback?: number
  /** The backend's bounds, mirrored so the refusal is visible before the 400. */
  min?: number
  max?: number
}

/** The defaults of the keys that have one, and of the fields that start on. */
const DEFAULT_SEEDS_PER_COMBINATION = 1
const DEFAULT_POINTS_PER_SPHERE = 100
const DEFAULT_PRECISION = 18

/**
 * The numeric keys of the payload, each with the rule the backend applies.
 *
 * This is the payload's own list, not one invented for the form: `n_particles`
 * and `sticking_probability` travel in every `base_parameters`, and the three
 * counted keys are the ones that can be emptied into a default.
 */
const NUMERIC_RULES = {
  n_particles: { whole: true },
  sticking_probability: { whole: false },
  seeds_per_combination: { whole: true, fallback: DEFAULT_SEEDS_PER_COMBINATION },
  points_per_sphere: {
    whole: true,
    fallback: DEFAULT_POINTS_PER_SPHERE,
    min: 10,
    max: 1000,
  },
  precision: { whole: true, fallback: DEFAULT_PRECISION, min: 8, max: 21 },
} satisfies Record<string, NumericRule>

/**
 * Read one numeric field, in one place, so no key can go back to `|| default`.
 *
 * The tone of the two parse messages is the one the rest of the form already
 * speaks (`distributionShape`): the key in quotes, lowercase, no full stop. The
 * two range messages are the backend's own, copied from
 * `validate_box_counting_params_dict`, so client and server say the same
 * sentence about the same rule.
 */
function readNumeric(key: string, raw: string, rule: NumericRule): NumericReading {
  const shape = rule.whole ? 'a whole number' : 'a number'
  const token = raw.trim()

  if (!token) {
    return rule.fallback === undefined
      ? { kind: 'invalid', message: `'${key}' must be ${shape}` }
      : { kind: 'value', value: rule.fallback }
  }

  const parsed = rule.whole ? parseInt(token, 10) : parseFloat(token)
  if (!Number.isFinite(parsed)) {
    return { kind: 'invalid', message: `'${key}' must be ${shape}` }
  }
  if (
    (rule.min !== undefined && parsed < rule.min) ||
    (rule.max !== undefined && parsed > rule.max)
  ) {
    return { kind: 'invalid', message: `${key} must be between ${rule.min} and ${rule.max}` }
  }

  return { kind: 'value', value: parsed }
}

/** The number a reading resolved to, for a caller that has already refused. */
function resolvedNumber(reading: NumericReading): number {
  if (reading.kind !== 'value') {
    // Unreachable: `handleSubmit` refuses every reading that is not a value
    // before it builds anything. Thrown rather than defaulted, because a
    // default here is the silent substitution this form was fixed to stop.
    throw new Error('a numeric field that did not resolve reached the payload')
  }
  return reading.value
}

/**
 * The refusal a numeric field shows, in a wrapper that carries the id its input
 * points at with `aria-describedby`.
 *
 * The message is a `Callout` for the reason `DistributionSelector` gives: a tint
 * alone is not a state, so the notice also carries an icon and a title. Its
 * `danger` tone renders as an `alert`, which is what a refusal that blocks the
 * submit button has to be.
 */
function FieldRefusal({ id, message }: { id: string; message: string | null }) {
  if (!message) return null
  return (
    <div id={id}>
      <Callout tone="danger" title={message} />
    </div>
  )
}

/**
 * The create-batch-study form, on the design-system kit (issue #181, slice 2).
 *
 * One `Panel` per block, in the order the study is built: what it is called,
 * the base parameters every run shares, the variations swept over them, the
 * optional box-counting pass, and the projected load with its two thresholds.
 * Each panel is a `<section>` headed by an `h2`, which is what puts the five of
 * them in the heading outline under the page's only `h1`.
 *
 * They are not landmarks. A `<section>` without an accessible name is not one,
 * and `Panel` does not name its own, so this file makes no claim about regions:
 * the guarantee on offer is the heading outline.
 *
 * The two run-count thresholds used to be coloured paragraphs - amber above 200
 * and red above 1000 - and they are `Callout`s now, which is the difference
 * between a tint and a state: each carries an icon and a title, so the refusal
 * survives greyscale and colour blindness. The dropped-variation notice (R10.6)
 * keeps its live region and moved inside the panel whose control drops it.
 *
 * Every count on screen goes through `Num` - the projected total, the
 * per-variation tally and the seed/combination breakdown - so a reading can be
 * aligned down a column and read apart from its unit.
 *
 * Nothing about what the form *does* changed with the port. Same fields, same
 * defaults, same payload: the tests pin the serialised request, key order
 * included. The two coercion defects the port found and deliberately left alone
 * - they are behaviour, not presentation - were fixed afterwards, and this is
 * how:
 *
 * - An unparseable or emptied numeric key is refused on the client, with a
 *   message that names the key, instead of travelling raw. `parseFloat('abc')`
 *   is `NaN` and `JSON.stringify` serialises that as `null`, so
 *   `sticking_probability` left the form as null and the API accepted and
 *   stored it: corruption with nothing on screen (#241).
 * - A legitimate zero is respected where the backend accepts it, and refused
 *   out loud where it does not, instead of `parseInt(x) || fallback` reading it
 *   as absence (#242).
 *
 * Both live in `readNumeric` below, which is the only place a numeric string
 * becomes a number.
 */
export function BatchSimulationForm({ onSubmit, isLoading }: BatchSimulationFormProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [algorithm, setAlgorithm] = useState<SimulationAlgorithm>('ballistic')
  const [nParticles, setNParticles] = useState('100')
  const [stickingProbability, setStickingProbability] = useState('1.0')
  const [seedsPerCombo, setSeedsPerCombo] = useState(
    String(DEFAULT_SEEDS_PER_COMBINATION),
  )
  const [variations, setVariations] = useState<ParameterVariation[]>([])
  const [droppedVariations, setDroppedVariations] = useState<string[]>([])
  // Limiting case specific state
  const [baseGeometry, setBaseGeometry] = useState<string>('chain')
  const [baseConfiguration, setBaseConfiguration] = useState<string>('lineal')
  const [basePacking, setBasePacking] = useState<string>('HC')
  const [baseSintering, setBaseSintering] = useState('1.0')

  // Box-counting analysis option
  const [includeBoxCounting, setIncludeBoxCounting] = useState(false)
  const [boxCountingPointsPerSphere, setBoxCountingPointsPerSphere] = useState(
    String(DEFAULT_POINTS_PER_SPHERE),
  )
  const [boxCountingPrecision, setBoxCountingPrecision] = useState(
    String(DEFAULT_PRECISION),
  )

  // #241: a field is called out only once the submit button has been pressed.
  // Shouting while the user is still typing is worse than saying nothing, which
  // is the reason `DistributionSelector` reports on blur; here the state a
  // refusal describes is "this could not be submitted", so it appears when that
  // is true and disappears as soon as the value is corrected.
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Update configuration when geometry changes
  const handleGeometryChange = (newGeometry: string) => {
    setBaseGeometry(newGeometry)
    setBaseConfiguration(getDefaultConfigForGeometry(newGeometry))
    // Set default packing for sphere
    if (newGeometry === 'sphere') {
      setBasePacking('CCC')
    } else {
      setBasePacking('HC')
    }
  }

  // Parameters that must be integers
  const integerParams = useMemo(() => new Set(['n_particles']), [])

  const addVariation = () => {
    setVariations([...variations, {
      name: 'n_particles',
      inputMode: 'discrete',
      values: '',
      start: '100',
      end: '1000',
      step: '100',
      distributionValues: [{ mode: 'fixed', value: 1.0 }],
      seedTypeValues: ['monomers'],
    }])
  }

  const removeVariation = (index: number) => {
    setVariations(variations.filter((_, i) => i !== index))
  }

  const updateVariation = <K extends keyof ParameterVariation>(
    index: number,
    field: K,
    value: ParameterVariation[K]
  ) => {
    const updated = [...variations]
    updated[index] = { ...updated[index], [field]: value }
    setVariations(updated)
  }

  // Every numeric key of the payload, read once. The count on screen, the
  // refusal and the request all come from these, so the three cannot disagree -
  // which is how `Run 1 Simulations` came to sit above a payload saying 1 while
  // the field said 0 (#242).
  const readings = useMemo(
    () => ({
      n_particles: readNumeric('n_particles', nParticles, NUMERIC_RULES.n_particles),
      sticking_probability: readNumeric(
        'sticking_probability',
        stickingProbability,
        NUMERIC_RULES.sticking_probability,
      ),
      seeds_per_combination: readNumeric(
        'seeds_per_combination',
        seedsPerCombo,
        NUMERIC_RULES.seeds_per_combination,
      ),
      points_per_sphere: readNumeric(
        'points_per_sphere',
        boxCountingPointsPerSphere,
        NUMERIC_RULES.points_per_sphere,
      ),
      precision: readNumeric(
        'precision',
        boxCountingPrecision,
        NUMERIC_RULES.precision,
      ),
    }),
    [
      nParticles,
      stickingProbability,
      seedsPerCombo,
      boxCountingPointsPerSphere,
      boxCountingPrecision,
    ],
  )

  // A refused reading blocks the submit. The two box-counting keys only travel
  // when that option is on, so a field the user tried and then abandoned cannot
  // refuse a study that never asked for it.
  const numericRefusal = [
    readings.n_particles,
    readings.sticking_probability,
    readings.seeds_per_combination,
    ...(includeBoxCounting
      ? [readings.points_per_sphere, readings.precision]
      : []),
  ].some((reading) => reading.kind === 'invalid')

  // #243, found in review: a distribution entry with an empty box has no payload,
  // and filtering it out of a grid *silently shortens* what the study sweeps while
  // the counts on this screen still count it. The submit is refused here instead —
  // the selector's per-field border was never a gate.
  const distributionRefusal = variations.reduce<string | null>((found, variation) => {
    if (found !== null) return found
    if (!variation.name || !DISTRIBUTION_PARAMS.has(variation.name)) return found
    if (variation.distributionValues.length === 0) return found
    const broken = firstDistributionError(variation.distributionValues, variation.name)
    return broken === null
      ? found
      : `${variation.name} #${broken.index + 1}: ${broken.error.message}`
  }, null)

  const hasRefusal = numericRefusal || distributionRefusal !== null

  const shownRefusal = (reading: NumericReading): string | null =>
    submitAttempted && reading.kind === 'invalid' ? reading.message : null

  // Limiting cases are deterministic, so always 1 seed. An unparseable zero-key
  // shows its default while it is refused: there is no honest number to project
  // from a field that does not hold one, and the submit is blocked anyway.
  const seedsForDisplay =
    readings.seeds_per_combination.kind === 'value'
      ? readings.seeds_per_combination.value
      : DEFAULT_SEEDS_PER_COMBINATION
  const effectiveSeeds = algorithm === 'limiting' ? 1 : seedsForDisplay

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (hasRefusal) {
      // #241: an unparseable token used to reach the payload as `NaN`, which
      // `JSON.stringify` writes as `null` - and `sticking_probability: null` is
      // accepted and stored by the server, so the study was created with a
      // value nobody chose. The batch page displays no submit error at all,
      // which is why the refusal has to be visible here and nothing may be
      // sent.
      setSubmitAttempted(true)
      return
    }
    setSubmitAttempted(false)

    // Build base parameters (different for limiting vs other algorithms)
    const baseParams: Record<string, unknown> = algorithm === 'limiting'
      ? {
          n_particles: resolvedNumber(readings.n_particles),
          geometry_type: baseGeometry,
          configuration_type: baseConfiguration,
          packing: basePacking,
          // R10.6: an emptied field is not a number. Submitting NaN here
          // serialises to null and the API answers 400 on a value the user
          // never typed.
          ...(Number.isFinite(parseFloat(baseSintering))
            ? { sintering_coeff: parseFloat(baseSintering) }
            : {}),
        }
      : {
          n_particles: resolvedNumber(readings.n_particles),
          sticking_probability: resolvedNumber(readings.sticking_probability),
        }

    // Build parameter grid from variations
    const parameterGrid: Record<string, unknown[]> = {}
    for (const variation of variations) {
      if (!variation.name) continue

      if (DISTRIBUTION_PARAMS.has(variation.name)) {
        // Distribution grid values are objects, not scalars
        if (variation.distributionValues.length > 0) {
          // R10.5: sintering speaks its own shape; the two distribution keys
          // send the `mode` shape the engine pipeline reads, which the backend
          // accepts for the algorithm that consumes them. Measured: a `mode`
          // config on `kf_distribution` and a `uniform` on
          // `particle_radius_config` both answer 201 on `tunable_cc`.
          parameterGrid[variation.name] =
            variation.name === 'sintering_config'
              ? // An empty box is not a number, and the API has no shape for one:
                // validation refuses it before submit, so this filter only keeps a
                // null from travelling if that gate ever moves (#243).
                variation.distributionValues.filter(isComplete).map(toSinteringConfig)
              : variation.distributionValues
        }
      } else if (variation.name === SEED_TYPE_PARAM) {
        if (variation.seedTypeValues.length > 0) {
          parameterGrid[variation.name] = variation.seedTypeValues
        }
      } else {
        const isInteger = integerParams.has(variation.name)
        const values = getVariationValues(variation, isInteger)
        if (values.length > 0) {
          parameterGrid[variation.name] = values
        }
      }
    }

    const data: CreateParametricStudyInput = {
      name: name || `Batch ${algorithm} Study`,
      description,
      base_algorithm: algorithm,
      base_parameters: baseParams,
      parameter_grid: parameterGrid,
      // Limiting cases are deterministic, so always 1 seed. Otherwise the number
      // the user asked for, zero included: the server accepts
      // `seeds_per_combination: 0`, so inventing a 1 here is the substitution
      // #242 is about.
      seeds_per_combination: effectiveSeeds,
      // Box-counting analysis option
      include_box_counting: includeBoxCounting,
      box_counting_params: includeBoxCounting ? {
        // The defaults an emptied field resolves to are the backend's own, read
        // from `validate_box_counting_params_dict`, not numbers chosen here.
        points_per_sphere: resolvedNumber(readings.points_per_sphere),
        precision: resolvedNumber(readings.precision),
      } : undefined,
    }

    onSubmit(data)
  }

  // Calculate total simulations
  const variationCounts = useMemo(() => {
    return variations.map((v) => {
      if (DISTRIBUTION_PARAMS.has(v.name)) {
        // SAFETY: the projection only counts and counts-down this array; it never
        // reads an element as a number. `parameter_grid` accepts numbers and seed
        // type strings in the same slot, and the union of both is what TypeScript
        // cannot express here without a discriminant this value does not carry.
        return { values: v.distributionValues as unknown as (number | string)[], count: v.distributionValues.length || 1 }
      }
      if (v.name === SEED_TYPE_PARAM) {
        return { values: v.seedTypeValues as (number | string)[], count: v.seedTypeValues.length || 1 }
      }
      const isInteger = integerParams.has(v.name)
      const values = getVariationValues(v, isInteger)
      return { values, count: values.length || 1 }
    })
  }, [variations, integerParams])

  const totalCombinations = variationCounts.reduce((acc, v) => acc * v.count, 1)
  const totalSimulations = totalCombinations * effectiveSeeds

  // What each field shows, once the submit has been attempted. The border is the
  // same `destructive` bridge token `DistributionSelector` marks its fields with,
  // so a refused number looks the same wherever it is refused.
  const nParticlesRefusal = shownRefusal(readings.n_particles)
  const stickingRefusal = shownRefusal(readings.sticking_probability)
  const seedsRefusal = shownRefusal(readings.seeds_per_combination)
  const pointsPerSphereRefusal = includeBoxCounting
    ? shownRefusal(readings.points_per_sphere)
    : null
  const precisionRefusal = includeBoxCounting
    ? shownRefusal(readings.precision)
    : null
  const refusalClass = (message: string | null) =>
    message ? 'border-destructive focus-visible:ring-destructive' : undefined

  const parameterOptions = useMemo(() => parameterOptionsFor(algorithm), [algorithm])

  // R10.6: a variation configured for one algorithm may be meaningless for the
  // next one. Carrying it over let the form submit a payload the backend
  // rejects with 400 - and the batch page shows no error, so the user saw a
  // button that did nothing.
  const handleAlgorithmChange = (next: SimulationAlgorithm) => {
    // The authority on what to clear is R11 - what the backend refuses - not
    // which options this dropdown lists. Clearing by the dropdown deleted
    // variations the server accepts (a flat sintering_coeff on ballistic,
    // sticking_probability on tunable) and told the user they were rejected.
    const labels = new Map(
      [...parameterOptionsFor(next), ...parameterOptionsFor(algorithm)].map(
        (o) => [o.value, o.label] as const,
      ),
    )
    const rejected = (v: ParameterVariation) =>
      Boolean(v.name) && rejectsVariation(next, v.name, v.distributionValues)
    const dropped = variations.filter(rejected)
    setVariations(variations.filter((v) => !rejected(v)))
    setDroppedVariations(dropped.map((v) => labels.get(v.name) ?? v.name))
    setAlgorithm(next)
  }

  const seedVariation = variations.find((v) => v.name === SEED_TYPE_PARAM)
  const seedIsMonomersOnly =
    !seedVariation ||
    seedVariation.seedTypeValues.length === 0 ||
    seedVariation.seedTypeValues.every((value) => value === 'monomers')
  const numbersOf = (name: string): number[] => {
    const variation = variations.find((v) => v.name === name)
    return variation
      ? getVariationValues(variation, false).filter(
          (value): value is number => typeof value === 'number',
        )
      : []
  }
  const highestDf = Math.max(0, ...numbersOf('target_df'))
  const lowestKfSwept = numbersOf('target_kf')
  const lowestKf = lowestKfSwept.length ? Math.min(...lowestKfSwept) : 1.3
  const dimersAdvice = seedIsMonomersOnly && needsDimers(highestDf, lowestKf)

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* What the study is called */}
      <Panel title="Study" bodyClassName="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Study Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., N-particles sweep"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional study description..."
            rows={2}
          />
        </div>
      </Panel>

      {/* Base parameters - conditional on the algorithm */}
      <Panel title="Base Parameters" bodyClassName="space-y-4">
        {/* Named: the panel title is not the control's label, and there are
            several comboboxes in this form. */}
        <div className="space-y-2">
          <Label htmlFor="algorithm">Algorithm</Label>
          <Select
            id="algorithm"
            value={algorithm}
            onChange={(e) => handleAlgorithmChange(e.target.value as SimulationAlgorithm)}
            options={batchSimulationAlgorithmOptions}
          />
        </div>

        {/* R10.6: clearing a variation silently would satisfy the payload half
            of the rule and fail its sentence - the form must not submit
            something the backend rejects "without telling the user why". */}
        {droppedVariations.length > 0 && (
          <div role="status" aria-live="polite">
            <Callout tone="warning" title="A variation no longer applies">
              {droppedVariations.length === 1
                ? `${droppedVariations[0]} was removed because ${algorithm} does not accept it.`
                : `${droppedVariations.length} variations were removed because ${algorithm} does not accept them: ${droppedVariations.join(', ')}.`}
            </Callout>
          </div>
        )}

        {algorithm === 'limiting' ? (
          /* Limiting case parameters */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="baseGeometry">Base Geometry</Label>
                <Select
                  id="baseGeometry"
                  value={baseGeometry}
                  onChange={(e) => handleGeometryChange(e.target.value)}
                  options={limitingGeometryOptions}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="baseConfiguration">Configuration</Label>
                <Select
                  id="baseConfiguration"
                  value={baseConfiguration}
                  onChange={(e) => setBaseConfiguration(e.target.value)}
                  options={getConfigOptionsForGeometry(baseGeometry)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nParticles">Base N Particles</Label>
                <Input
                  id="nParticles"
                  type="number"
                  value={nParticles}
                  onChange={(e) => setNParticles(e.target.value)}
                  min={1}
                  max={10000}
                  aria-invalid={nParticlesRefusal ? true : undefined}
                  aria-describedby={nParticlesRefusal ? 'nParticles-error' : undefined}
                  className={refusalClass(nParticlesRefusal)}
                />
                <FieldRefusal id="nParticles-error" message={nParticlesRefusal} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="basePacking">Packing</Label>
                <Select
                  id="basePacking"
                  value={basePacking}
                  onChange={(e) => setBasePacking(e.target.value)}
                  options={packingOptions}
                />
                <p className="hint">Affects plane &amp; sphere geometries</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sintering">Base Sintering Coeff.</Label>
                <Input
                  id="sintering"
                  type="number"
                  value={baseSintering}
                  onChange={(e) => setBaseSintering(e.target.value)}
                  min={0.5}
                  max={1}
                  step={0.05}
                />
                <p className="hint">1.0 = touching, 0.5 = 50% overlap</p>
              </div>
            </div>
          </div>
        ) : (
          /* Standard algorithm parameters */
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nParticles">Base N Particles</Label>
              <Input
                id="nParticles"
                type="number"
                value={nParticles}
                onChange={(e) => setNParticles(e.target.value)}
                min={10}
                max={100000}
                aria-invalid={nParticlesRefusal ? true : undefined}
                aria-describedby={nParticlesRefusal ? 'nParticles-error' : undefined}
                className={refusalClass(nParticlesRefusal)}
              />
              <FieldRefusal id="nParticles-error" message={nParticlesRefusal} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sticking">Base Sticking Prob.</Label>
              <Input
                id="sticking"
                type="number"
                value={stickingProbability}
                onChange={(e) => setStickingProbability(e.target.value)}
                min={0}
                max={1}
                step={0.1}
                aria-invalid={stickingRefusal ? true : undefined}
                aria-describedby={stickingRefusal ? 'sticking-error' : undefined}
                className={refusalClass(stickingRefusal)}
              />
              <FieldRefusal id="sticking-error" message={stickingRefusal} />
            </div>
          </div>
        )}

        {/* Seeds per combination - not needed for limiting (deterministic) */}
        {algorithm !== 'limiting' && (
          <div className="space-y-2">
            <Label htmlFor="seeds">Seeds per Combination</Label>
            <Input
              id="seeds"
              type="number"
              value={seedsPerCombo}
              onChange={(e) => setSeedsPerCombo(e.target.value)}
              min={1}
              max={10}
              aria-invalid={seedsRefusal ? true : undefined}
              aria-describedby={seedsRefusal ? 'seeds-error' : undefined}
              className={refusalClass(seedsRefusal)}
            />
            <FieldRefusal id="seeds-error" message={seedsRefusal} />
            <p className="hint">
              Run multiple simulations per parameter combination with different random seeds
            </p>
          </div>
        )}
      </Panel>

      {/* Parameter Variations */}
      <Panel
        title="Parameter Variations"
        action={
          <Button type="button" variant="outline" size="sm" onClick={addVariation}>
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            Add Variation
          </Button>
        }
        bodyClassName="space-y-3"
      >
        {variations.length === 0 && (
          <p className="hint py-2">Add parameters to vary across simulations</p>
        )}

        {variations.map((variation, index) => {
          const isInteger = integerParams.has(variation.name)
          const { values, count } = variationCounts[index] || { values: [], count: 0 }

          return (
            <div
              key={index}
              className="min-w-0 space-y-3 rounded-md border border-line bg-surface-soft p-3"
            >
              {/* Parameter Selection & Delete */}
              <div className="flex gap-2 items-end">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="text-[11px]">Parameter</Label>
                  <Select
                    aria-label={`Parameter for variation ${index + 1}`}
                    value={variation.name}
                    onChange={(e) => updateVariation(index, 'name', e.target.value)}
                    options={parameterOptions}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove variation ${index + 1}`}
                  onClick={() => removeVariation(index)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              {/* Conditional value input based on parameter type */}
              {DISTRIBUTION_PARAMS.has(variation.name) ? (
                /* Distribution grid input for kf_distribution, particle_radius, sintering */
                <DistributionGridInput
                  value={variation.distributionValues}
                  onChange={(newVals) => updateVariation(index, 'distributionValues', newVals)}
                  label={`${variation.name.replace(/_/g, ' ')} configurations`}
                  parameterName={variation.name}
                />
              ) : variation.name === SEED_TYPE_PARAM ? (
                /* Seed type multi-select chips */
                <div className="space-y-2">
                  <Label className="text-[11px]">Select seed types</Label>
                  <div className="flex gap-2">
                    {SEED_TYPE_OPTIONS.map((st) => {
                      const isSelected = variation.seedTypeValues.includes(st)
                      return (
                        <Button
                          key={st}
                          type="button"
                          variant={isSelected ? 'default' : 'outline'}
                          size="sm"
                          className="flex-1 capitalize"
                          onClick={() => {
                            const newValues = isSelected
                              ? variation.seedTypeValues.filter((v) => v !== st)
                              : [...variation.seedTypeValues, st]
                            // Enforce min 1
                            if (newValues.length > 0) {
                              updateVariation(index, 'seedTypeValues', newValues)
                            }
                          }}
                        >
                          {st}
                        </Button>
                      )
                    })}
                  </div>
                  {/* The count is a `Num`, so the number and the word that
                      qualifies it are separate nodes. */}
                  <p className="hint">
                    <Num value={variation.seedTypeValues.length} digits={0} size="sm" /> selected
                  </p>
                </div>
              ) : (
                /* Standard scalar variation: discrete or range */
                <>
                  {/* Input Mode Toggle */}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={variation.inputMode === 'range' ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1"
                      onClick={() => updateVariation(index, 'inputMode', 'range')}
                    >
                      Range (Start → End)
                    </Button>
                    <Button
                      type="button"
                      variant={variation.inputMode === 'discrete' ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1"
                      onClick={() => updateVariation(index, 'inputMode', 'discrete')}
                    >
                      Discrete Values
                    </Button>
                  </div>

                  {/* Range Mode Inputs */}
                  {variation.inputMode === 'range' && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`variation-${index}-start`} className="text-[11px]">
                          Start
                        </Label>
                        <Input
                          id={`variation-${index}-start`}
                          type="number"
                          value={variation.start}
                          onChange={(e) => updateVariation(index, 'start', e.target.value)}
                          placeholder="100"
                          step={isInteger ? 1 : 0.1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`variation-${index}-end`} className="text-[11px]">
                          End
                        </Label>
                        <Input
                          id={`variation-${index}-end`}
                          type="number"
                          value={variation.end}
                          onChange={(e) => updateVariation(index, 'end', e.target.value)}
                          placeholder="1000"
                          step={isInteger ? 1 : 0.1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`variation-${index}-step`} className="text-[11px]">
                          Step
                        </Label>
                        <Input
                          id={`variation-${index}-step`}
                          type="number"
                          value={variation.step}
                          onChange={(e) => updateVariation(index, 'step', e.target.value)}
                          placeholder="100"
                          min={isInteger ? 1 : 0.01}
                          step={isInteger ? 1 : 0.1}
                        />
                      </div>
                    </div>
                  )}

                  {/* Discrete Mode Input */}
                  {variation.inputMode === 'discrete' && (
                    <div className="space-y-1">
                      <Label htmlFor={`variation-${index}-values`} className="text-[11px]">
                        Values (comma-separated)
                      </Label>
                      <Input
                        id={`variation-${index}-values`}
                        value={variation.values}
                        onChange={(e) => updateVariation(index, 'values', e.target.value)}
                        placeholder="e.g., 100, 200, 500, 1000"
                      />
                    </div>
                  )}

                  {/* Preview */}
                  <div className="space-y-1 rounded-md border border-line bg-surface-strong p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="hint">Generated values:</span>
                      <Num value={count} digits={0} unit="values" size="sm" />
                    </div>
                    <p className="num truncate text-[11px] text-ink-muted">
                      {formatValuesPreview(values)}
                    </p>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </Panel>

      {/* Box-Counting Analysis Option */}
      <Panel title="Box-Counting Analysis" bodyClassName="space-y-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="includeBoxCounting"
            checked={includeBoxCounting}
            onChange={(e) => setIncludeBoxCounting(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line-strong"
          />
          <div>
            <Label htmlFor="includeBoxCounting" className="cursor-pointer">
              Run Box-Counting Analysis
            </Label>
            <p className="hint">
              Compute fractal dimension (Df) using 3D box-counting algorithm
            </p>
          </div>
        </div>

        {includeBoxCounting && (
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-1">
              <Label htmlFor="boxCountingPointsPerSphere" className="text-[11px]">
                Points per Sphere
              </Label>
              <Input
                id="boxCountingPointsPerSphere"
                type="number"
                value={boxCountingPointsPerSphere}
                onChange={(e) => setBoxCountingPointsPerSphere(e.target.value)}
                min={10}
                max={1000}
                placeholder="100"
                aria-invalid={pointsPerSphereRefusal ? true : undefined}
                aria-describedby={
                  pointsPerSphereRefusal ? 'boxCountingPointsPerSphere-error' : undefined
                }
                className={refusalClass(pointsPerSphereRefusal)}
              />
              <FieldRefusal
                id="boxCountingPointsPerSphere-error"
                message={pointsPerSphereRefusal}
              />
              <p className="hint">Surface sampling density (higher = more accurate)</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="boxCountingPrecision" className="text-[11px]">
                Precision (bits)
              </Label>
              <Input
                id="boxCountingPrecision"
                type="number"
                value={boxCountingPrecision}
                onChange={(e) => setBoxCountingPrecision(e.target.value)}
                min={8}
                // The validator's ceiling, not the 24 this field used to
                // advertise: a 22 was accepted by the input and refused by
                // `validate_box_counting_params_dict`, with a 400 the batch page
                // never displays.
                max={21}
                placeholder="18"
                aria-invalid={precisionRefusal ? true : undefined}
                aria-describedby={precisionRefusal ? 'boxCountingPrecision-error' : undefined}
                className={refusalClass(precisionRefusal)}
              />
              <FieldRefusal id="boxCountingPrecision-error" message={precisionRefusal} />
              <p className="hint">Morton code precision (18 recommended)</p>
            </div>
          </div>
        )}
      </Panel>

      {/* Projected load */}
      <Panel title="Total simulations" bodyClassName="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <Num value={totalSimulations} digits={0} size="lg" />
          {variations.length > 0 && (
            <span className="hint">
              (<Num value={totalCombinations} digits={0} unit="combinations" size="sm" /> ×{' '}
              <Num value={effectiveSeeds} digits={0} unit="seeds" size="sm" />)
            </span>
          )}
          {includeBoxCounting && (
            <span className="hint">+ box-counting</span>
          )}
        </div>

        {totalSimulations > 200 && totalSimulations <= 1000 && (
          <Callout tone="warning" title="This may take a while">
            Batch contains <Num value={totalSimulations} digits={0} /> simulations.
          </Callout>
        )}

        {totalSimulations > 1000 && (
          <Callout tone="danger" title="Batch exceeds 1000 simulations">
            <Num value={totalSimulations} digits={0} /> runs requested. The server
            will reject this request.
          </Callout>
        )}
      </Panel>

      {/* Submit */}
      {submitAttempted && distributionRefusal && (
        <Callout tone="danger" title={distributionRefusal} />
      )}

      {/* #315: the same advice as #311, read from the same module so the two screens
          cannot drift. It matters more here: in a sweep the target is missed after
          every child has run. The gate takes the *highest* Df the grid reaches and the
          *lowest* kf it sweeps, because that pair is the one that misses. */}
      {dimersAdvice && (
        <p role="status" className="text-sm text-ink-muted">
          {DIMERS_ADVICE}
        </p>
      )}

      <Button type="submit" disabled={isLoading || totalSimulations === 0 || totalSimulations > 1000} className="w-full">
        <Play className="h-4 w-4 mr-2" aria-hidden="true" />
        {isLoading ? 'Creating Study...' : `Run ${totalSimulations} Simulations`}
      </Button>
    </form>
  )
}
