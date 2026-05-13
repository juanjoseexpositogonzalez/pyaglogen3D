'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, Play, AlertTriangle } from 'lucide-react'
import { batchSimulationAlgorithmOptions } from '@/lib/simulation-algorithms'
import { DistributionGridInput } from './DistributionGridInput'
import type { SimulationAlgorithm, CreateParametricStudyInput, DistributionValue } from '@/lib/types'

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
        const num = parseInt(trimmed, 10)
        return isNaN(num) ? trimmed : num
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

export function BatchSimulationForm({ onSubmit, isLoading }: BatchSimulationFormProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [algorithm, setAlgorithm] = useState<SimulationAlgorithm>('ballistic')
  const [nParticles, setNParticles] = useState('100')
  const [stickingProbability, setStickingProbability] = useState('1.0')
  const [seedsPerCombo, setSeedsPerCombo] = useState('1')
  const [variations, setVariations] = useState<ParameterVariation[]>([])
  // Limiting case specific state
  const [baseGeometry, setBaseGeometry] = useState<string>('chain')
  const [baseConfiguration, setBaseConfiguration] = useState<string>('lineal')
  const [basePacking, setBasePacking] = useState<string>('HC')
  const [baseSintering, setBaseSintering] = useState('1.0')

  // Box-counting analysis option
  const [includeBoxCounting, setIncludeBoxCounting] = useState(false)
  const [boxCountingPointsPerSphere, setBoxCountingPointsPerSphere] = useState('100')
  const [boxCountingPrecision, setBoxCountingPrecision] = useState('18')

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Build base parameters (different for limiting vs other algorithms)
    const baseParams: Record<string, unknown> = algorithm === 'limiting'
      ? {
          n_particles: parseInt(nParticles),
          geometry_type: baseGeometry,
          configuration_type: baseConfiguration,
          packing: basePacking,
          sintering_coeff: parseFloat(baseSintering),
        }
      : {
          n_particles: parseInt(nParticles),
          sticking_probability: parseFloat(stickingProbability),
        }

    // Build parameter grid from variations
    const parameterGrid: Record<string, unknown[]> = {}
    for (const variation of variations) {
      if (!variation.name) continue

      if (DISTRIBUTION_PARAMS.has(variation.name)) {
        // Distribution grid values are objects, not scalars
        if (variation.distributionValues.length > 0) {
          parameterGrid[variation.name] = variation.distributionValues
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
      // Limiting cases are deterministic, so always 1 seed
      seeds_per_combination: algorithm === 'limiting' ? 1 : (parseInt(seedsPerCombo) || 1),
      // Box-counting analysis option
      include_box_counting: includeBoxCounting,
      box_counting_params: includeBoxCounting ? {
        points_per_sphere: parseInt(boxCountingPointsPerSphere) || 100,
        precision: parseInt(boxCountingPrecision) || 18,
      } : undefined,
    }

    onSubmit(data)
  }

  // Calculate total simulations
  const variationCounts = useMemo(() => {
    return variations.map((v) => {
      if (DISTRIBUTION_PARAMS.has(v.name)) {
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
  // Limiting cases are deterministic, so always 1 seed
  const effectiveSeeds = algorithm === 'limiting' ? 1 : (parseInt(seedsPerCombo) || 1)
  const totalSimulations = totalCombinations * effectiveSeeds

  const parameterOptions = useMemo(() => {
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

    // New batch-CC parameter grid options
    options.push(
      { value: 'kf_distribution', label: 'kf distribution (normal/uniform/fixed)' },
      { value: 'particle_radius_config', label: 'Particle radius (polydispersity)' },
      { value: 'sintering_config', label: 'Sintering coefficient distribution' },
      { value: 'seed_type', label: 'Seed type (monomer/dimer/trimer)' },
    )

    return options
  }, [algorithm])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Batch Simulation</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Study Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Study Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., N-particles sweep"
            />
          </div>

          {/* Description */}
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

          {/* Algorithm */}
          <div className="space-y-2">
            <Label>Algorithm</Label>
            <Select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as SimulationAlgorithm)}
              options={batchSimulationAlgorithmOptions}
            />
          </div>

          {/* Base Parameters - conditional based on algorithm */}
          {algorithm === 'limiting' ? (
            /* Limiting case parameters */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Base Geometry</Label>
                  <Select
                    value={baseGeometry}
                    onChange={(e) => handleGeometryChange(e.target.value)}
                    options={limitingGeometryOptions}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Configuration</Label>
                  <Select
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
                  />
                </div>
                <div className="space-y-2">
                  <Label>Packing</Label>
                  <Select
                    value={basePacking}
                    onChange={(e) => setBasePacking(e.target.value)}
                    options={packingOptions}
                  />
                  <p className="text-xs text-muted-foreground">
                    Affects plane & sphere geometries
                  </p>
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
                  <p className="text-xs text-muted-foreground">
                    1.0 = touching, 0.5 = 50% overlap
                  </p>
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
                />
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
                />
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
              />
              <p className="text-xs text-muted-foreground">
                Run multiple simulations per parameter combination with different random seeds
              </p>
            </div>
          )}

          {/* Parameter Variations */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Parameter Variations</Label>
              <Button type="button" variant="outline" size="sm" onClick={addVariation}>
                <Plus className="h-4 w-4 mr-1" />
                Add Variation
              </Button>
            </div>

            {variations.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                Add parameters to vary across simulations
              </p>
            )}

            {variations.map((variation, index) => {
              const isInteger = integerParams.has(variation.name)
              const { values, count } = variationCounts[index] || { values: [], count: 0 }

              return (
                <div key={index} className="p-3 border rounded-lg bg-muted/30 space-y-3">
                  {/* Parameter Selection & Delete */}
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Parameter</Label>
                      <Select
                        value={variation.name}
                        onChange={(e) => updateVariation(index, 'name', e.target.value)}
                        options={parameterOptions}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeVariation(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Conditional value input based on parameter type */}
                  {DISTRIBUTION_PARAMS.has(variation.name) ? (
                    /* Distribution grid input for kf_distribution, particle_radius, sintering */
                    <DistributionGridInput
                      value={variation.distributionValues}
                      onChange={(newVals) => updateVariation(index, 'distributionValues', newVals)}
                      label={`${variation.name.replace(/_/g, ' ')} configurations`}
                      allowedTypes={
                        variation.name === 'particle_radius_config'
                          ? ['fixed', 'normal']
                          : undefined
                      }
                    />
                  ) : variation.name === SEED_TYPE_PARAM ? (
                    /* Seed type multi-select chips */
                    <div className="space-y-2">
                      <Label className="text-xs">Select seed types</Label>
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
                      <p className="text-xs text-muted-foreground">
                        {variation.seedTypeValues.length} selected
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
                            <Label className="text-xs">Start</Label>
                            <Input
                              type="number"
                              value={variation.start}
                              onChange={(e) => updateVariation(index, 'start', e.target.value)}
                              placeholder="100"
                              step={isInteger ? 1 : 0.1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">End</Label>
                            <Input
                              type="number"
                              value={variation.end}
                              onChange={(e) => updateVariation(index, 'end', e.target.value)}
                              placeholder="1000"
                              step={isInteger ? 1 : 0.1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Step</Label>
                            <Input
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
                          <Label className="text-xs">Values (comma-separated)</Label>
                          <Input
                            value={variation.values}
                            onChange={(e) => updateVariation(index, 'values', e.target.value)}
                            placeholder="e.g., 100, 200, 500, 1000"
                          />
                        </div>
                      )}

                      {/* Preview */}
                      <div className="p-2 bg-primary/5 rounded text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Generated values:</span>
                          <span className="font-mono font-medium">{count} values</span>
                        </div>
                        <p className="text-xs font-mono text-muted-foreground truncate">
                          {formatValuesPreview(values)}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Box-Counting Analysis Option */}
          <div className="space-y-3 p-3 border rounded-lg">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includeBoxCounting"
                checked={includeBoxCounting}
                onChange={(e) => setIncludeBoxCounting(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <div>
                <Label htmlFor="includeBoxCounting" className="cursor-pointer">
                  Run Box-Counting Analysis
                </Label>
                <p className="text-xs text-muted-foreground">
                  Compute fractal dimension (Df) using 3D box-counting algorithm
                </p>
              </div>
            </div>

            {includeBoxCounting && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Points per Sphere</Label>
                  <Input
                    type="number"
                    value={boxCountingPointsPerSphere}
                    onChange={(e) => setBoxCountingPointsPerSphere(e.target.value)}
                    min={10}
                    max={1000}
                    placeholder="100"
                  />
                  <p className="text-xs text-muted-foreground">
                    Surface sampling density (higher = more accurate)
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Precision (bits)</Label>
                  <Input
                    type="number"
                    value={boxCountingPrecision}
                    onChange={(e) => setBoxCountingPrecision(e.target.value)}
                    min={8}
                    max={24}
                    placeholder="18"
                  />
                  <p className="text-xs text-muted-foreground">
                    Morton code precision (18 recommended)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="p-3 bg-primary/10 rounded-lg space-y-2">
            <p className="text-sm">
              <span className="font-medium">Total simulations:</span>{' '}
              <span className="font-mono">{totalSimulations}</span>
              {variations.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}({totalCombinations} combinations × {effectiveSeeds} seeds)
                </span>
              )}
              {includeBoxCounting && (
                <span className="text-muted-foreground ml-2">
                  + box-counting
                </span>
              )}
            </p>

            {totalSimulations > 200 && totalSimulations <= 1000 && (
              <p className="text-sm text-yellow-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Batch contains {totalSimulations} simulations — this may take a while.
              </p>
            )}

            {totalSimulations > 1000 && (
              <p className="text-sm text-destructive font-medium flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Batch exceeds 1000 simulations ({totalSimulations}). The server will reject this request.
              </p>
            )}
          </div>

          {/* Submit */}
          <Button type="submit" disabled={isLoading || totalSimulations === 0 || totalSimulations > 1000} className="w-full">
            <Play className="h-4 w-4 mr-2" />
            {isLoading ? 'Creating Study...' : `Run ${totalSimulations} Simulations`}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
