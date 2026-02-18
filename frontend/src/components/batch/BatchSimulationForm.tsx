'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, Play } from 'lucide-react'
import type { SimulationAlgorithm, CreateParametricStudyInput } from '@/lib/types'

const algorithmOptions = [
  { value: 'ballistic', label: 'Ballistic Particle-Cluster' },
  { value: 'ballistic_cc', label: 'Ballistic Cluster-Cluster' },
  { value: 'dla', label: 'Diffusion-Limited Aggregation' },
  { value: 'cca', label: 'Cluster-Cluster Aggregation' },
  { value: 'tunable', label: 'Tunable Fractal Dimension' },
]

interface ParameterVariation {
  name: string
  values: string // Comma-separated values
}

interface BatchSimulationFormProps {
  onSubmit: (data: CreateParametricStudyInput) => void
  isLoading?: boolean
}

export function BatchSimulationForm({ onSubmit, isLoading }: BatchSimulationFormProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [algorithm, setAlgorithm] = useState<SimulationAlgorithm>('ballistic')
  const [nParticles, setNParticles] = useState('100')
  const [stickingProbability, setStickingProbability] = useState('1.0')
  const [seedsPerCombo, setSeedsPerCombo] = useState('1')
  const [variations, setVariations] = useState<ParameterVariation[]>([])

  const addVariation = () => {
    setVariations([...variations, { name: 'n_particles', values: '' }])
  }

  const removeVariation = (index: number) => {
    setVariations(variations.filter((_, i) => i !== index))
  }

  const updateVariation = (index: number, field: keyof ParameterVariation, value: string) => {
    const updated = [...variations]
    updated[index] = { ...updated[index], [field]: value }
    setVariations(updated)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Build base parameters
    const baseParams: Record<string, unknown> = {
      n_particles: parseInt(nParticles),
      sticking_probability: parseFloat(stickingProbability),
    }

    // Build parameter grid from variations
    // Parameters that must be integers
    const integerParams = new Set(['n_particles'])

    const parameterGrid: Record<string, unknown[]> = {}
    for (const variation of variations) {
      if (variation.name && variation.values) {
        const values = variation.values.split(',').map((v) => {
          const trimmed = v.trim()
          // Use parseInt for integer parameters, parseFloat for others
          if (integerParams.has(variation.name)) {
            const num = parseInt(trimmed, 10)
            return isNaN(num) ? trimmed : num
          }
          const num = parseFloat(trimmed)
          return isNaN(num) ? trimmed : num
        })
        parameterGrid[variation.name] = values
      }
    }

    const data: CreateParametricStudyInput = {
      name: name || `Batch ${algorithm} Study`,
      description,
      base_algorithm: algorithm,
      base_parameters: baseParams,
      parameter_grid: parameterGrid,
      seeds_per_combination: parseInt(seedsPerCombo) || 1,
    }

    onSubmit(data)
  }

  // Calculate total simulations
  const totalCombinations = variations.reduce((acc, v) => {
    const count = v.values ? v.values.split(',').filter(Boolean).length : 1
    return acc * (count || 1)
  }, 1)
  const totalSimulations = totalCombinations * (parseInt(seedsPerCombo) || 1)

  const parameterOptions = [
    { value: 'n_particles', label: 'Number of Particles' },
    { value: 'sticking_probability', label: 'Sticking Probability' },
    { value: 'target_df', label: 'Target Df (tunable only)' },
    { value: 'target_kf', label: 'Target kf (tunable only)' },
  ]

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
              options={algorithmOptions}
            />
          </div>

          {/* Base Parameters */}
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

          {/* Seeds per combination */}
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

            {variations.map((variation, index) => (
              <div key={index} className="flex gap-2 items-end p-3 border rounded-lg bg-muted/30">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Parameter</Label>
                  <Select
                    value={variation.name}
                    onChange={(e) => updateVariation(index, 'name', e.target.value)}
                    options={parameterOptions}
                  />
                </div>
                <div className="flex-[2] space-y-1">
                  <Label className="text-xs">Values (comma-separated)</Label>
                  <Input
                    value={variation.values}
                    onChange={(e) => updateVariation(index, 'values', e.target.value)}
                    placeholder="e.g., 100, 200, 500, 1000"
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
            ))}
          </div>

          {/* Summary */}
          <div className="p-3 bg-primary/10 rounded-lg">
            <p className="text-sm">
              <span className="font-medium">Total simulations:</span>{' '}
              <span className="font-mono">{totalSimulations}</span>
              {variations.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}({totalCombinations} combinations × {seedsPerCombo} seeds)
                </span>
              )}
            </p>
          </div>

          {/* Submit */}
          <Button type="submit" disabled={isLoading || totalSimulations === 0} className="w-full">
            <Play className="h-4 w-4 mr-2" />
            {isLoading ? 'Creating Study...' : `Run ${totalSimulations} Simulations`}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
