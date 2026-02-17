'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SimulationAlgorithm, CreateSimulationInput } from '@/lib/types'

interface SimulationFormProps {
  onSubmit: (data: CreateSimulationInput) => void
  isLoading?: boolean
}

const algorithmOptions: { value: SimulationAlgorithm; label: string }[] = [
  { value: 'dla', label: 'DLA (Diffusion-Limited Aggregation)' },
  { value: 'cca', label: 'CCA (Cluster-Cluster Aggregation)' },
  { value: 'ballistic', label: 'Ballistic Aggregation' },
]

interface FormParams {
  n_particles: number
  sticking_probability: number
  // DLA specific
  lattice_size: number
  // CCA specific
  box_size: number
  // Polydisperse radius (all algorithms)
  radius_min: number
  radius_max: number
  polydisperse: boolean
}

const defaultParams: FormParams = {
  n_particles: 1000,
  sticking_probability: 1.0,
  lattice_size: 200,
  box_size: 100.0,
  radius_min: 1.0,
  radius_max: 1.0,
  polydisperse: false,
}

const algorithmDescriptions: Record<SimulationAlgorithm, string> = {
  dla: 'Diffusion-Limited Aggregation: Particles undergo random walks and stick upon contact. Produces fractal structures with Df ~ 2.4-2.6.',
  cca: 'Cluster-Cluster Aggregation: Multiple clusters move and merge upon collision. Produces more open structures with Df ~ 1.8-2.0.',
  ballistic: 'Ballistic Aggregation: Particles travel in straight lines until contact. Produces denser structures with Df ~ 2.8-3.0.',
  tunable: 'DLA with adjustable sticking probability to tune fractal dimension.',
}

export function SimulationForm({ onSubmit, isLoading }: SimulationFormProps) {
  const [algorithm, setAlgorithm] = useState<SimulationAlgorithm>('dla')
  const [params, setParams] = useState<FormParams>(defaultParams)
  const [seed, setSeed] = useState<string>('')

  const handleAlgorithmChange = (value: SimulationAlgorithm) => {
    setAlgorithm(value)
  }

  const updateParam = <K extends keyof FormParams>(key: K, value: FormParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Build algorithm-specific parameters
    let algorithmParams: Record<string, number | undefined> = {
      n_particles: params.n_particles,
      sticking_probability: params.sticking_probability,
      radius_min: params.radius_min,
      // Only include radius_max if polydisperse
      radius_max: params.polydisperse ? params.radius_max : undefined,
    }

    // Add algorithm-specific parameters
    if (algorithm === 'dla' || algorithm === 'tunable') {
      algorithmParams.lattice_size = params.lattice_size
    } else if (algorithm === 'cca') {
      algorithmParams.box_size = params.box_size
    }

    // Remove undefined values
    algorithmParams = Object.fromEntries(
      Object.entries(algorithmParams).filter(([, v]) => v !== undefined)
    ) as Record<string, number>

    onSubmit({
      algorithm,
      parameters: algorithmParams as unknown as CreateSimulationInput['parameters'],
      seed: seed ? parseInt(seed) : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Algorithm Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Algorithm</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={algorithm}
            onChange={(e) => handleAlgorithmChange(e.target.value as SimulationAlgorithm)}
            options={algorithmOptions}
          />
          <p className="text-sm text-muted-foreground">
            {algorithmDescriptions[algorithm]}
          </p>
        </CardContent>
      </Card>

      {/* Common Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Number of Particles */}
          <div className="space-y-2">
            <Label htmlFor="n_particles">Number of Particles</Label>
            <Input
              id="n_particles"
              type="number"
              min={10}
              max={100000}
              value={params.n_particles}
              onChange={(e) => updateParam('n_particles', parseInt(e.target.value) || 1000)}
            />
            <p className="text-xs text-muted-foreground">
              Total particles in the agglomerate (10 - 100,000)
            </p>
          </div>

          {/* Sticking Probability */}
          <div className="space-y-2">
            <Label>
              Sticking Probability: {params.sticking_probability.toFixed(2)}
            </Label>
            <Slider
              min={0.01}
              max={1}
              step={0.01}
              value={[params.sticking_probability]}
              onValueChange={([v]) => updateParam('sticking_probability', v)}
            />
            <p className="text-xs text-muted-foreground">
              Probability of adhesion on contact (0 = never, 1 = always)
            </p>
          </div>

          {/* Particle Radius Section (all algorithms) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Particle Radius</Label>
              <Button
                type="button"
                variant={params.polydisperse ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  updateParam('polydisperse', !params.polydisperse)
                  if (!params.polydisperse) {
                    // Enable polydisperse: set max to min + 20%
                    updateParam('radius_max', params.radius_min * 1.2)
                  }
                }}
              >
                {params.polydisperse ? 'Polydisperse' : 'Monodisperse'}
              </Button>
            </div>

            {params.polydisperse ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="radius_min">Min Radius</Label>
                  <Input
                    id="radius_min"
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={params.radius_min}
                    onChange={(e) => updateParam('radius_min', parseFloat(e.target.value) || 1.0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radius_max">Max Radius</Label>
                  <Input
                    id="radius_max"
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={params.radius_max}
                    onChange={(e) => updateParam('radius_max', parseFloat(e.target.value) || 1.0)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  id="radius"
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={params.radius_min}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 1.0
                    updateParam('radius_min', val)
                    updateParam('radius_max', val)
                  }}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {params.polydisperse
                ? 'Particles will have random radii between min and max'
                : 'All particles will have the same radius'
              }
            </p>
          </div>

          {/* Algorithm-specific parameters */}
          {(algorithm === 'dla' || algorithm === 'tunable') && (
            <div className="space-y-2">
              <Label htmlFor="lattice_size">Lattice Size</Label>
              <Input
                id="lattice_size"
                type="number"
                min={50}
                max={2000}
                value={params.lattice_size}
                onChange={(e) => updateParam('lattice_size', parseInt(e.target.value) || 200)}
              />
              <p className="text-xs text-muted-foreground">
                Size of the simulation domain
              </p>
            </div>
          )}

          {algorithm === 'cca' && (
            <div className="space-y-2">
              <Label htmlFor="box_size">Box Size</Label>
              <Input
                id="box_size"
                type="number"
                min={10}
                max={1000}
                value={params.box_size}
                onChange={(e) => updateParam('box_size', parseFloat(e.target.value) || 100.0)}
              />
              <p className="text-xs text-muted-foreground">
                Size of the periodic simulation box
              </p>
            </div>
          )}

          {/* Random Seed */}
          <div className="space-y-2">
            <Label htmlFor="seed">Random Seed (optional)</Label>
            <Input
              id="seed"
              type="number"
              placeholder="Leave empty for random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Set a seed for reproducible results
            </p>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Starting Simulation...' : 'Run Simulation'}
      </Button>
    </form>
  )
}
