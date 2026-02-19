'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Info } from 'lucide-react'
import type { SimulationAlgorithm, CreateSimulationInput } from '@/lib/types'

/**
 * Get complete hexagonal counts: 1, 7, 19, 37, 61, 91, 127, 169, ...
 * Formula: N(k) = 1 + 3k(k+1) for k complete rings
 */
function getCompleteHexagonalCounts(maxN: number): number[] {
  const counts: number[] = []
  for (let k = 0; ; k++) {
    const n = 1 + 3 * k * (k + 1)
    if (n > maxN) break
    counts.push(n)
  }
  return counts
}

/**
 * Get the nearest complete hexagonal count <= targetN
 */
function getNearestCompleteHexagonal(targetN: number): number {
  const counts = getCompleteHexagonalCounts(targetN + 100)
  let nearest = 1
  for (const n of counts) {
    if (n <= targetN) {
      nearest = n
    } else {
      break
    }
  }
  return nearest
}

/**
 * Get complete shell counts for 3D compact clusters (magic numbers)
 */
function getCompleteShellCounts(): number[] {
  return [1, 4, 6, 13, 55, 147, 309, 561]
}

/**
 * Get the nearest complete shell count <= targetN
 */
function getNearestCompleteShell(targetN: number): number {
  const counts = getCompleteShellCounts()
  let nearest = 1
  for (const n of counts) {
    if (n <= targetN) {
      nearest = n
    } else {
      break
    }
  }
  return nearest
}

interface SimulationFormProps {
  onSubmit: (data: CreateSimulationInput) => void
  isLoading?: boolean
}

const algorithmOptions: { value: SimulationAlgorithm; label: string }[] = [
  { value: 'dla', label: 'DLA (Diffusion-Limited Aggregation)' },
  { value: 'cca', label: 'CCA (Brownian Cluster-Cluster)' },
  { value: 'ballistic', label: 'Ballistic PC (Particle-Cluster)' },
  { value: 'ballistic_cc', label: 'Ballistic CC (Cluster-Cluster)' },
  { value: 'tunable', label: 'Tunable PC (Filippov method)' },
  { value: 'tunable_cc', label: 'Tunable CC (Cluster-Cluster)' },
  { value: 'limiting', label: 'Limiting Case Geometry (Reference)' },
]

type LimitingGeometryType = 'chain' | 'plane' | 'sphere'

const limitingGeometryOptions: { value: LimitingGeometryType; label: string }[] = [
  { value: 'chain', label: 'Chain (Df = 1)' },
  { value: 'plane', label: 'Plane (Df = 2)' },
  { value: 'sphere', label: 'Sphere (Df = 3)' },
]

// Configuration types per geometry
type ChainConfig = 'lineal' | 'cruz2d' | 'asterisco' | 'cruz3d'
type PlaneConfig = 'plano' | 'dobleplano' | 'tripleplano'
type SphereConfig = 'cuboctaedro'
type PackingType = 'HC' | 'CS' | 'CCC'

const chainConfigOptions: { value: ChainConfig; label: string; description: string }[] = [
  { value: 'lineal', label: 'Linear', description: 'Straight line along one axis' },
  { value: 'cruz2d', label: '2D Cross', description: 'Two perpendicular branches' },
  { value: 'asterisco', label: 'Asterisk', description: 'Six branches at 60° intervals' },
  { value: 'cruz3d', label: '3D Cross', description: 'Three orthogonal branches' },
]

const planeConfigOptions: { value: PlaneConfig; label: string; description: string }[] = [
  { value: 'plano', label: 'Single Plane', description: 'One flat layer' },
  { value: 'dobleplano', label: 'Double Plane', description: 'Two perpendicular planes' },
  { value: 'tripleplano', label: 'Triple Plane', description: 'Three planes at 60° (HC only)' },
]

const sphereConfigOptions: { value: SphereConfig; label: string; description: string }[] = [
  { value: 'cuboctaedro', label: 'Cuboctahedron', description: '3D compact structure' },
]

const packingOptions2D: { value: PackingType; label: string; description: string }[] = [
  { value: 'HC', label: 'HC', description: 'Hexagonal Compact' },
  { value: 'CS', label: 'CS', description: 'Cubic Simple' },
]

const packingOptions3D: { value: PackingType; label: string; description: string }[] = [
  { value: 'HC', label: 'HC', description: 'Hexagonal Compact' },
  { value: 'CS', label: 'CS', description: 'Cubic Simple' },
  { value: 'CCC', label: 'CCC', description: 'Face-Centered Cubic' },
]

interface FormParams {
  n_particles: number
  sticking_probability: number
  // DLA specific
  lattice_size: number
  // CCA specific
  box_size: number
  single_agglomerate: boolean
  // Tunable specific (PC and CC)
  target_df: number
  target_kf: number
  // Tunable CC specific
  seed_cluster_size: number | null  // null = use monomers
  max_rotation_attempts: number
  // Limiting case specific
  geometry_type: LimitingGeometryType
  configuration_type: ChainConfig | PlaneConfig | SphereConfig
  packing: PackingType
  layers: number | null  // layer-based input
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
  seed_cluster_size: null,  // null = start with monomers
  max_rotation_attempts: 50,
  geometry_type: 'chain',
  configuration_type: 'lineal',
  packing: 'HC',
  layers: null,
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
  tunable: 'Tunable PC (Filippov method): Generate aggregates with target fractal dimension and prefactor. Based on N = kf × (Rg/rp)^Df power law.',
  tunable_cc: 'Tunable CC (Cluster-Cluster): Similar to Tunable PC but merges clusters instead of single particles. Produces more realistic aggregates with controlled Df and kf.',
  limiting: 'Reference Geometry: Deterministic canonical structures for calibration. Choose between linear chain (Df=1), hexagonal plane (Df=2), or compact sphere (Df=3).',
}

/**
 * Calculate N from layer count for each geometry type
 */
function getParticleCountFromLayers(geometryType: LimitingGeometryType, layers: number): number {
  if (geometryType === 'chain') {
    return layers // For chain, layers = N directly
  }
  if (geometryType === 'plane') {
    // Hexagonal: N = 1 + 3k(k+1) where k = number of rings
    const k = layers
    return 1 + 3 * k * (k + 1)
  }
  if (geometryType === 'sphere') {
    // Return magic number for shell index
    const shells = getCompleteShellCounts()
    return shells[Math.min(layers, shells.length - 1)] || 1
  }
  return layers
}

/**
 * Get layer count from particle count (inverse of above)
 */
function getLayersFromParticleCount(geometryType: LimitingGeometryType, n: number): number {
  if (geometryType === 'chain') {
    return n
  }
  if (geometryType === 'plane') {
    // Solve: N = 1 + 3k(k+1) for k
    // 3k² + 3k + 1 - N = 0
    // k = (-3 + sqrt(9 + 12(N-1))) / 6
    if (n <= 1) return 0
    const k = Math.floor((-3 + Math.sqrt(9 + 12 * (n - 1))) / 6)
    return Math.max(0, k)
  }
  if (geometryType === 'sphere') {
    const shells = getCompleteShellCounts()
    for (let i = shells.length - 1; i >= 0; i--) {
      if (shells[i] <= n) return i
    }
    return 0
  }
  return 0
}

/**
 * Get configuration options for geometry type
 */
function getConfigOptions(geometryType: LimitingGeometryType) {
  if (geometryType === 'chain') return chainConfigOptions
  if (geometryType === 'plane') return planeConfigOptions
  if (geometryType === 'sphere') return sphereConfigOptions
  return []
}

/**
 * Get default configuration for geometry type
 */
function getDefaultConfig(geometryType: LimitingGeometryType): ChainConfig | PlaneConfig | SphereConfig {
  if (geometryType === 'chain') return 'lineal'
  if (geometryType === 'plane') return 'plano'
  return 'cuboctaedro'
}

/**
 * Check if packing is supported for configuration
 */
function supportsPackingSelection(geometryType: LimitingGeometryType, config: string): boolean {
  if (geometryType === 'chain') return false
  if (geometryType === 'plane' && config === 'tripleplano') return false  // HC only
  return true
}

/**
 * Calculate actual total particles for a configuration
 */
function calculateTotalParticles(
  geometryType: LimitingGeometryType,
  config: string,
  nInput: number
): number {
  if (geometryType === 'chain') {
    if (config === 'lineal') return nInput
    if (config === 'cruz2d') {
      // For cruz2d: horizontal branch + 2 vertical branches sharing center
      return nInput % 2 === 0 ? nInput * 2 : nInput + 2 * Math.floor(nInput / 2)
    }
    if (config === 'asterisco') {
      // 3 diagonals sharing center
      return nInput % 2 === 0 ? nInput * 3 : nInput * 3 - 2
    }
    if (config === 'cruz3d') {
      // 3 orthogonal branches sharing center
      return nInput % 2 === 0 ? nInput * 3 : nInput * 3 - 2
    }
  }
  return nInput
}

/**
 * Limiting geometry section with cleaner N input
 */
function LimitingGeometrySection({
  params,
  updateParam,
}: {
  params: FormParams
  updateParam: <K extends keyof FormParams>(key: K, value: FormParams[K]) => void
}) {
  // Calculate current layer count from n_particles
  const currentLayers = useMemo(() => {
    return getLayersFromParticleCount(params.geometry_type, params.n_particles)
  }, [params.geometry_type, params.n_particles])

  // Handle geometry type change
  const handleGeometryChange = (newType: LimitingGeometryType) => {
    updateParam('geometry_type', newType)
    updateParam('configuration_type', getDefaultConfig(newType))
    if (newType === 'chain') {
      updateParam('packing', 'HC')
    }
  }

  // Handle layer input change (for plane/sphere)
  const handleLayerChange = (newLayers: number) => {
    const newN = getParticleCountFromLayers(params.geometry_type, newLayers)
    updateParam('n_particles', newN)
    updateParam('layers', newLayers)
  }

  // Get max layers for each geometry type
  const maxLayers = useMemo(() => {
    if (params.geometry_type === 'chain') return 50
    if (params.geometry_type === 'plane') return 20
    if (params.geometry_type === 'sphere') return getCompleteShellCounts().length - 1
    return 50
  }, [params.geometry_type])

  // Get layer label based on geometry type
  const layerLabel = params.geometry_type === 'plane' ? 'Rings (k)' : 'Shell'

  // Get current config options
  const configOptions = getConfigOptions(params.geometry_type)
  const showPacking = supportsPackingSelection(params.geometry_type, params.configuration_type)
  const packingOptions = params.geometry_type === 'sphere' ? packingOptions3D : packingOptions2D

  // Check if this is a branched configuration (where N means particles per arm)
  const isBranchedConfig = params.geometry_type === 'chain' && params.configuration_type !== 'lineal'

  // Calculate total particles for display
  const totalParticles = calculateTotalParticles(
    params.geometry_type,
    params.configuration_type,
    params.n_particles
  )

  return (
    <div className="space-y-4">
      {/* Geometry Type (Df) */}
      <div className="space-y-2">
        <Label htmlFor="geometry_type">Fractal Dimension (Df)</Label>
        <Select
          value={params.geometry_type}
          onChange={(e) => handleGeometryChange(e.target.value as LimitingGeometryType)}
          options={limitingGeometryOptions}
        />
        <p className="text-xs text-muted-foreground">
          {params.geometry_type === 'chain' && 'Df = 1: Linear structures (kf → √3 ≈ 1.732)'}
          {params.geometry_type === 'plane' && 'Df = 2: Planar structures (kf → 9/5 = 1.8)'}
          {params.geometry_type === 'sphere' && 'Df = 3: Compact structures (kf ≈ 1.0)'}
        </p>
      </div>

      {/* Configuration Type */}
      <div className="space-y-2">
        <Label>Configuration</Label>
        <div className="grid grid-cols-2 gap-2">
          {configOptions.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={params.configuration_type === opt.value ? 'default' : 'outline'}
              size="sm"
              className="h-auto py-2 px-3 flex flex-col items-start"
              onClick={() => updateParam('configuration_type', opt.value)}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs opacity-70 text-left">{opt.description}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Packing Type (for plane and sphere) */}
      {showPacking && (
        <div className="space-y-2">
          <Label>Packing Type</Label>
          <div className="flex gap-2">
            {packingOptions.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={params.packing === opt.value ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => updateParam('packing', opt.value)}
                title={opt.description}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {params.packing === 'HC' && 'Hexagonal Compact: Dense, natural packing'}
            {params.packing === 'CS' && 'Cubic Simple: Regular grid arrangement'}
            {params.packing === 'CCC' && 'Face-Centered Cubic: Highest packing density'}
          </p>
        </div>
      )}

      {/* Primary Particle Count Input */}
      {params.geometry_type === 'chain' && (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
          <div className="space-y-2">
            <Label htmlFor="n_particles">
              {isBranchedConfig ? 'Particles per Arm (N)' : 'Number of Particles (N)'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="n_particles"
                type="number"
                min={1}
                max={100}
                value={params.n_particles}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1
                  updateParam('n_particles', Math.max(1, Math.min(100, val)))
                }}
                className="font-mono"
              />
              <div className="flex gap-1">
                {[1, 2, 3, 5, 10].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={params.n_particles === n ? 'default' : 'outline'}
                    size="sm"
                    className="h-10 w-10 p-0 font-mono"
                    onClick={() => updateParam('n_particles', n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {isBranchedConfig
                ? `Number of primary particles per arm/branch (1-100)`
                : `Total number of particles in the chain (1-100)`
              }
            </p>
          </div>

          {/* Show calculated total for branched configs */}
          {isBranchedConfig && (
            <div className="flex items-center justify-between p-2 bg-primary/10 rounded">
              <span className="text-sm">Calculated total particles:</span>
              <span className="text-lg font-bold font-mono">{totalParticles}</span>
            </div>
          )}
        </div>
      )}

      {/* Layer-based input for plane/sphere */}
      {params.geometry_type !== 'chain' && (
        <div className="bg-muted/50 rounded-lg p-3 space-y-3">
          <Label className="text-sm font-medium">
            {`Number of ${layerLabel}`}
          </Label>

          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <Slider
                id="layer-count"
                min={0}
                max={maxLayers}
                step={1}
                value={[currentLayers]}
                onValueChange={([v]) => handleLayerChange(v)}
              />
            </div>
            <div className="text-right min-w-[80px]">
              <p className="text-xs text-muted-foreground">{layerLabel}</p>
              <p className="text-lg font-bold font-mono">{currentLayers}</p>
            </div>
          </div>

          {/* Formula explanation */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {params.geometry_type === 'plane' && `N = 1 + 3×${currentLayers}×${currentLayers + 1}`}
              {params.geometry_type === 'sphere' && `Shell ${currentLayers}`}
            </span>
            <span className="font-mono font-bold">
              = {getParticleCountFromLayers(params.geometry_type, currentLayers)} particles
            </span>
          </div>

          {/* Quick layer buttons */}
          <div className="flex flex-wrap gap-1 pt-2 border-t">
            {Array.from({ length: Math.min(10, maxLayers + 1) }, (_, i) => i).map((layer) => {
              const n = getParticleCountFromLayers(params.geometry_type, layer)
              return (
                <Button
                  key={layer}
                  type="button"
                  variant={currentLayers === layer ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleLayerChange(layer)}
                >
                  {params.geometry_type === 'plane' ? `k=${layer}` : `S${layer}`}
                  <span className="ml-1 opacity-60">({n})</span>
                </Button>
              )
            })}
          </div>
        </div>
      )}

      {/* Current selection summary */}
      <div className="p-3 bg-primary/5 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Configuration:</span>
          <span className="font-medium">
            {params.configuration_type}
            {showPacking && ` (${params.packing})`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {isBranchedConfig ? 'Per arm:' : 'Total particles:'}
          </span>
          <span className="font-bold font-mono">
            {isBranchedConfig ? `N = ${params.n_particles}` : `N = ${params.n_particles}`}
          </span>
        </div>
        {isBranchedConfig && (
          <div className="flex items-center justify-between pt-1 border-t">
            <span className="text-sm text-muted-foreground">Total particles:</span>
            <span className="text-lg font-bold font-mono text-primary">{totalParticles}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function SimulationForm({ onSubmit, isLoading }: SimulationFormProps) {
  const [algorithm, setAlgorithm] = useState<SimulationAlgorithm>('dla')
  const [params, setParams] = useState<FormParams>(defaultParams)
  const [seed, setSeed] = useState<string>('')

  const handleAlgorithmChange = (value: SimulationAlgorithm) => {
    setAlgorithm(value)
    // Set sensible defaults when switching algorithms
    if (value === 'limiting') {
      // Default to N=7 (first complete hexagonal ring) for limiting case
      updateParam('n_particles', 7)
    } else if (params.n_particles < 10) {
      // Reset to default if coming from limiting case with small N
      updateParam('n_particles', 1000)
    }
  }

  const updateParam = <K extends keyof FormParams>(key: K, value: FormParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Build algorithm-specific parameters
    // Backend uses dimensionless units (radius ~1.0), we store nm for display
    let algorithmParams: Record<string, number | boolean | string | undefined> = {
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
    } else if (algorithm === 'tunable_cc') {
      algorithmParams.target_df = params.target_df
      algorithmParams.target_kf = params.target_kf
      algorithmParams.seed_cluster_size = params.seed_cluster_size ?? undefined
      algorithmParams.max_rotation_attempts = params.max_rotation_attempts
    } else if (algorithm === 'limiting') {
      algorithmParams.geometry_type = params.geometry_type
      algorithmParams.configuration_type = params.configuration_type
      algorithmParams.packing = params.packing
      if (params.layers !== null) {
        algorithmParams.layers = params.layers
      }
    }

    // Remove undefined values (keep false for booleans)
    algorithmParams = Object.fromEntries(
      Object.entries(algorithmParams).filter(([, v]) => v !== undefined)
    ) as Record<string, number | boolean | string>

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
          {/* Number of Particles - hidden for limiting case (controlled by LimitingGeometrySection) */}
          {algorithm !== 'limiting' && (
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
          )}

          {/* Sticking Probability - hidden for limiting case (deterministic) */}
          {algorithm !== 'limiting' && (
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
          )}

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

          {/* Polydisperse Section - hidden for limiting case (canonical geometry) */}
          {algorithm !== 'limiting' && (
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
          )}

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

          {algorithm === 'tunable_cc' && (
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

              <div className="space-y-2">
                <Label htmlFor="seed_cluster_size">Seed Cluster Size (optional)</Label>
                <Input
                  id="seed_cluster_size"
                  type="number"
                  min={2}
                  max={50}
                  placeholder="Leave empty for monomers"
                  value={params.seed_cluster_size ?? ''}
                  onChange={(e) => updateParam('seed_cluster_size', e.target.value ? parseInt(e.target.value) : null)}
                />
                <p className="text-xs text-muted-foreground">
                  Initial cluster size (2-50). Leave empty to start with monomers.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_rotation_attempts">Max Rotation Attempts</Label>
                <Input
                  id="max_rotation_attempts"
                  type="number"
                  min={10}
                  max={200}
                  value={params.max_rotation_attempts}
                  onChange={(e) => updateParam('max_rotation_attempts', parseInt(e.target.value) || 50)}
                />
                <p className="text-xs text-muted-foreground">
                  Number of rotation attempts to resolve overlaps (10-200)
                </p>
              </div>
            </>
          )}

          {algorithm === 'limiting' && (
            <LimitingGeometrySection
              params={params}
              updateParam={updateParam}
            />
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
