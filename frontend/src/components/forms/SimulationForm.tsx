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
  seed_radius: number
  // CCA/Ballistic specific
  particle_radius: number
  box_size: number
}

const defaultParams: FormParams = {
  n_particles: 1000,
  sticking_probability: 1.0,
  lattice_size: 200,
  seed_radius: 1.0,
  particle_radius: 1.0,
  box_size: 100.0,
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
    let algorithmParams: Record<string, number>

    if (algorithm === 'dla' || algorithm === 'tunable') {
      algorithmParams = {
        n_particles: params.n_particles,
        sticking_probability: params.sticking_probability,
        lattice_size: params.lattice_size,
        seed_radius: params.seed_radius,
      }
    } else if (algorithm === 'cca') {
      algorithmParams = {
        n_particles: params.n_particles,
        sticking_probability: params.sticking_probability,
        particle_radius: params.particle_radius,
        box_size: params.box_size,
      }
    } else {
      // ballistic
      algorithmParams = {
        n_particles: params.n_particles,
        sticking_probability: params.sticking_probability,
        particle_radius: params.particle_radius,
      }
    }

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

          {/* Algorithm-specific parameters */}
          {(algorithm === 'dla' || algorithm === 'tunable') && (
            <>
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

              <div className="space-y-2">
                <Label htmlFor="seed_radius">Seed Radius</Label>
                <Input
                  id="seed_radius"
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={params.seed_radius}
                  onChange={(e) => updateParam('seed_radius', parseFloat(e.target.value) || 1.0)}
                />
              </div>
            </>
          )}

          {algorithm === 'cca' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="particle_radius">Particle Radius</Label>
                <Input
                  id="particle_radius"
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={params.particle_radius}
                  onChange={(e) => updateParam('particle_radius', parseFloat(e.target.value) || 1.0)}
                />
              </div>

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
            </>
          )}

          {algorithm === 'ballistic' && (
            <div className="space-y-2">
              <Label htmlFor="particle_radius">Particle Radius</Label>
              <Input
                id="particle_radius"
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={params.particle_radius}
                onChange={(e) => updateParam('particle_radius', parseFloat(e.target.value) || 1.0)}
              />
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
