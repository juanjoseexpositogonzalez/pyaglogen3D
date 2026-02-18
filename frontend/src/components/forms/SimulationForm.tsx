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
  { value: 'cca', label: 'CCA (Brownian Cluster-Cluster)' },
  { value: 'ballistic', label: 'Ballistic PC (Particle-Cluster)' },
  { value: 'ballistic_cc', label: 'Ballistic CC (Cluster-Cluster)' },
  { value: 'tunable', label: 'Tunable Df (Filippov method)' },
]

interface FormParams {
  n_particles: number
  sticking_probability: number
  // DLA specific
  lattice_size: number
  // CCA specific
  box_size: number
  single_agglomerate: boolean
  // Tunable specific
  target_df: number
  target_kf: number
  // Primary particle size for display scaling
  primary_particle_radius_nm: number
  // Polydisperse radius ratio (all algorithms)
  radius_ratio_min: number  // ratio relative to primary (1.0 = same size)
  radius_ratio_max: number
  polydisperse: boolean
}

const defaultParams: FormParams = {
  n_particles: 1000,
  sticking_probability: 1.0,
  lattice_size: 200,
  box_size: 100.0,
  single_agglomerate: true,
  target_df: 1.8,
  target_kf: 1.3,
  primary_particle_radius_nm: 25.0,  // typical soot primary particle
  radius_ratio_min: 1.0,
  radius_ratio_max: 1.0,
  polydisperse: false,
}

const algorithmDescriptions: Record<SimulationAlgorithm, string> = {
  dla: 'Diffusion-Limited Aggregation: Particles undergo random walks and stick upon contact. Produces fractal structures with Df ~ 2.4-2.6.',
  cca: 'Brownian CCA: Clusters move via Brownian motion and merge on collision. Produces open structures with Df ~ 1.8-2.0.',
  ballistic: 'Ballistic PC: Particles travel in straight lines towards a growing cluster. Produces denser structures with Df ~ 2.8-3.0.',
  ballistic_cc: 'Ballistic CC: Clusters travel in straight lines and merge on collision. Produces branched structures with Df ~ 1.8-2.2 (thesis section 6.2).',
  tunable: 'Tunable Df (Filippov method): Generate aggregates with target fractal dimension and prefactor. Based on N = kf × (Rg/rp)^Df power law.',
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
    // Backend uses dimensionless units (radius ~1.0), we store nm for display
    let algorithmParams: Record<string, number | boolean | undefined> = {
      n_particles: params.n_particles,
      sticking_probability: params.sticking_probability,
      // Store primary particle size in nm for result scaling
      primary_particle_radius_nm: params.primary_particle_radius_nm,
      // Send dimensionless ratios to backend
      radius_min: params.radius_ratio_min,
      // Only include radius_max if polydisperse
      radius_max: params.polydisperse ? params.radius_ratio_max : undefined,
    }

    // Add algorithm-specific parameters
    if (algorithm === 'dla') {
      algorithmParams.lattice_size = params.lattice_size
    } else if (algorithm === 'cca') {
      algorithmParams.box_size = params.box_size
      algorithmParams.single_agglomerate = params.single_agglomerate
    } else if (algorithm === 'tunable') {
      algorithmParams.target_df = params.target_df
      algorithmParams.target_kf = params.target_kf
    }

    // Remove undefined values (keep false for booleans)
    algorithmParams = Object.fromEntries(
      Object.entries(algorithmParams).filter(([, v]) => v !== undefined)
    ) as Record<string, number | boolean>

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

          {/* Primary Particle Radius in nm */}
          <div className="space-y-2">
            <Label htmlFor="primary_radius">Primary Particle Radius (nm)</Label>
            <Input
              id="primary_radius"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={params.primary_particle_radius_nm}
              onChange={(e) => updateParam('primary_particle_radius_nm', parseFloat(e.target.value) || 25.0)}
            />
            <p className="text-xs text-muted-foreground">
              Physical size of primary particles. Results (Rg, coordinates) will be displayed in nm.
            </p>
          </div>

          {/* Polydisperse Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Size Distribution</Label>
              <Button
                type="button"
                variant={params.polydisperse ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  updateParam('polydisperse', !params.polydisperse)
                  if (!params.polydisperse) {
                    // Enable polydisperse: set ratio range
                    updateParam('radius_ratio_min', 0.8)
                    updateParam('radius_ratio_max', 1.2)
                  } else {
                    // Disable: reset to monodisperse
                    updateParam('radius_ratio_min', 1.0)
                    updateParam('radius_ratio_max', 1.0)
                  }
                }}
              >
                {params.polydisperse ? 'Polydisperse' : 'Monodisperse'}
              </Button>
            </div>

            {params.polydisperse && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="radius_ratio_min">
                    Min Ratio ({(params.radius_ratio_min * params.primary_particle_radius_nm).toFixed(1)} nm)
                  </Label>
                  <Input
                    id="radius_ratio_min"
                    type="number"
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    value={params.radius_ratio_min}
                    onChange={(e) => updateParam('radius_ratio_min', parseFloat(e.target.value) || 0.8)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radius_ratio_max">
                    Max Ratio ({(params.radius_ratio_max * params.primary_particle_radius_nm).toFixed(1)} nm)
                  </Label>
                  <Input
                    id="radius_ratio_max"
                    type="number"
                    min={1.0}
                    max={2.0}
                    step={0.05}
                    value={params.radius_ratio_max}
                    onChange={(e) => updateParam('radius_ratio_max', parseFloat(e.target.value) || 1.2)}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {params.polydisperse
                ? `Particle radii will vary from ${(params.radius_ratio_min * params.primary_particle_radius_nm).toFixed(1)} to ${(params.radius_ratio_max * params.primary_particle_radius_nm).toFixed(1)} nm`
                : `All particles will have radius ${params.primary_particle_radius_nm} nm`
              }
            </p>
          </div>

          {/* Algorithm-specific parameters */}
          {algorithm === 'dla' && (
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

          {algorithm === 'tunable' && (
            <>
              <div className="space-y-2">
                <Label>
                  Target Fractal Dimension (Df): {params.target_df.toFixed(2)}
                </Label>
                <Slider
                  min={1.4}
                  max={3.0}
                  step={0.1}
                  value={[params.target_df]}
                  onValueChange={([v]) => updateParam('target_df', v)}
                />
                <p className="text-xs text-muted-foreground">
                  Target fractal dimension (1.4 = open/fluffy, 3.0 = compact/dense)
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Target Prefactor (kf): {params.target_kf.toFixed(2)}
                </Label>
                <Slider
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={[params.target_kf]}
                  onValueChange={([v]) => updateParam('target_kf', v)}
                />
                <p className="text-xs text-muted-foreground">
                  Structural prefactor from N = kf × (Rg/rp)^Df
                </p>
              </div>
            </>
          )}

          {algorithm === 'cca' && (
            <>
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Agglomerate Mode</Label>
                  <Button
                    type="button"
                    variant={params.single_agglomerate ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateParam('single_agglomerate', !params.single_agglomerate)}
                  >
                    {params.single_agglomerate ? 'Single Agglomerate' : 'Multiple Agglomerates'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {params.single_agglomerate
                    ? 'Iterate until all particles form ONE connected agglomerate'
                    : 'Stop at iteration limit (may produce multiple separate clusters)'
                  }
                </p>
              </div>
            </>
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
