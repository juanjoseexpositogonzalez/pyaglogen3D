'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { simulationsApi } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { Loader2, Sun, Zap, Info } from 'lucide-react'

interface OpticalPropertiesSectionProps {
  projectId: string
  simulationId: string
  existingOptical?: {
    method: string
    wavelength: number
    refractive_index: { n: number; k: number }
    medium_index?: number
    c_ext: number
    c_sca: number
    c_abs: number
    q_ext: number
    q_sca: number
    q_abs: number
    asymmetry_g: number
    single_scatter_albedo: number
  } | null
}

type OpticalMethod = 'tmatrix' | 'dda'

// Default soot optical properties at 550 nm
const DEFAULT_PARAMS = {
  wavelength: 550,
  refractive_index_n: 1.95,
  refractive_index_k: 0.79,
  medium_index: 1.0,
  dipoles_per_wavelength: 10,
}

// Preset materials
const MATERIAL_PRESETS: Record<string, { n: number; k: number; label: string }> = {
  soot: { n: 1.95, k: 0.79, label: 'Soot (550nm)' },
  carbon: { n: 2.0, k: 1.0, label: 'Amorphous Carbon' },
  silica: { n: 1.46, k: 0.0, label: 'Silica (SiO2)' },
  water: { n: 1.33, k: 0.0, label: 'Water' },
  custom: { n: 1.5, k: 0.01, label: 'Custom' },
}

export function OpticalPropertiesSection({
  projectId,
  simulationId,
  existingOptical,
}: OpticalPropertiesSectionProps) {
  const [result, setResult] = useState(existingOptical || null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [method, setMethod] = useState<OpticalMethod>('tmatrix')
  const [wavelength, setWavelength] = useState(DEFAULT_PARAMS.wavelength)
  const [refractiveN, setRefractiveN] = useState(DEFAULT_PARAMS.refractive_index_n)
  const [refractiveK, setRefractiveK] = useState(DEFAULT_PARAMS.refractive_index_k)
  const [mediumIndex, setMediumIndex] = useState(DEFAULT_PARAMS.medium_index)
  const [dipolesPerWl, setDipolesPerWl] = useState(DEFAULT_PARAMS.dipoles_per_wavelength)
  const [selectedPreset, setSelectedPreset] = useState<string>('soot')

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey)
    if (presetKey !== 'custom') {
      const preset = MATERIAL_PRESETS[presetKey]
      setRefractiveN(preset.n)
      setRefractiveK(preset.k)
    }
  }

  const handleCalculate = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await simulationsApi.calculateOptical(projectId, simulationId, {
        method,
        wavelength,
        refractive_index_n: refractiveN,
        refractive_index_k: refractiveK,
        medium_index: mediumIndex,
        dipoles_per_wavelength: dipolesPerWl,
      })
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calculation failed')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, simulationId, method, wavelength, refractiveN, refractiveK, mediumIndex, dipolesPerWl])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sun className="h-5 w-5" />
          Optical Properties
        </CardTitle>
        <CardDescription>
          Calculate scattering and absorption cross-sections using T-Matrix or DDA methods.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Form */}
        <div className="space-y-4">
          {/* Method selection */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={method === 'tmatrix' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMethod('tmatrix')}
              className="flex-1"
            >
              <Zap className="h-4 w-4 mr-1" />
              T-Matrix
            </Button>
            <Button
              type="button"
              variant={method === 'dda' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMethod('dda')}
              className="flex-1"
            >
              <Zap className="h-4 w-4 mr-1" />
              DDA
            </Button>
          </div>

          {/* Method description */}
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              {method === 'tmatrix'
                ? 'T-Matrix: Fast multi-sphere superposition method. Best for moderate-size aggregates (<1000 particles).'
                : 'DDA: Discrete Dipole Approximation. More accurate for complex shapes but slower.'
              }
            </p>
          </div>

          {/* Parameters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wavelength">Wavelength (nm)</Label>
              <Input
                id="wavelength"
                type="number"
                min={100}
                max={2000}
                value={wavelength}
                onChange={(e) => setWavelength(parseFloat(e.target.value) || 550)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="medium">Medium Index</Label>
              <Input
                id="medium"
                type="number"
                min={1.0}
                max={2.0}
                step={0.01}
                value={mediumIndex}
                onChange={(e) => setMediumIndex(parseFloat(e.target.value) || 1.0)}
              />
            </div>
          </div>

          {/* Material presets */}
          <div className="space-y-2">
            <Label>Material</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(MATERIAL_PRESETS).map(([key, preset]) => (
                <Button
                  key={key}
                  type="button"
                  variant={selectedPreset === key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handlePresetChange(key)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Refractive index */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="refractiveN">Refractive Index (n)</Label>
              <Input
                id="refractiveN"
                type="number"
                min={1.0}
                max={4.0}
                step={0.01}
                value={refractiveN}
                onChange={(e) => {
                  setRefractiveN(parseFloat(e.target.value) || 1.5)
                  setSelectedPreset('custom')
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refractiveK">Absorption (k)</Label>
              <Input
                id="refractiveK"
                type="number"
                min={0}
                max={5.0}
                step={0.01}
                value={refractiveK}
                onChange={(e) => {
                  setRefractiveK(parseFloat(e.target.value) || 0)
                  setSelectedPreset('custom')
                }}
              />
            </div>
          </div>

          {/* DDA-specific parameter */}
          {method === 'dda' && (
            <div className="space-y-2">
              <Label htmlFor="dipoles">Dipoles per Wavelength</Label>
              <Input
                id="dipoles"
                type="number"
                min={5}
                max={30}
                value={dipolesPerWl}
                onChange={(e) => setDipolesPerWl(parseFloat(e.target.value) || 10)}
              />
              <p className="text-xs text-muted-foreground">
                Higher values = more accurate but slower (10-20 typical)
              </p>
            </div>
          )}

          {/* Calculate button */}
          <Button onClick={handleCalculate} disabled={isLoading} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Calculating...
              </>
            ) : (
              <>
                <Sun className="h-4 w-4 mr-2" />
                Calculate Optical Properties
              </>
            )}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 bg-destructive/10 text-destructive p-4 rounded-md">
            <p className="font-medium">Calculation failed</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && !isLoading && (
          <div className="mt-6 space-y-4">
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                Results
                <span className="text-xs text-muted-foreground font-normal">
                  ({result.method.toUpperCase()} at {result.wavelength}nm)
                </span>
              </h4>

              {/* Cross-sections */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Extinction (C_ext)</p>
                  <p className="text-lg font-bold font-mono">{formatNumber(result.c_ext, 4)}</p>
                  <p className="text-xs text-muted-foreground">nm²</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Scattering (C_sca)</p>
                  <p className="text-lg font-bold font-mono">{formatNumber(result.c_sca, 4)}</p>
                  <p className="text-xs text-muted-foreground">nm²</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Absorption (C_abs)</p>
                  <p className="text-lg font-bold font-mono">{formatNumber(result.c_abs, 4)}</p>
                  <p className="text-xs text-muted-foreground">nm²</p>
                </div>
              </div>

              {/* Efficiencies */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Q_ext</p>
                  <p className="font-mono font-medium">{formatNumber(result.q_ext, 3)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Q_sca</p>
                  <p className="font-mono font-medium">{formatNumber(result.q_sca, 3)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Q_abs</p>
                  <p className="font-mono font-medium">{formatNumber(result.q_abs, 3)}</p>
                </div>
              </div>

              {/* Key parameters */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-primary/5 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Single Scatter Albedo (SSA)</p>
                  <p className="text-2xl font-bold font-mono">{formatNumber(result.single_scatter_albedo, 4)}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.single_scatter_albedo > 0.9 ? 'Highly scattering' :
                     result.single_scatter_albedo > 0.5 ? 'Moderate absorption' :
                     'Highly absorbing'}
                  </p>
                </div>
                <div className="bg-primary/5 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Asymmetry Parameter (g)</p>
                  <p className="text-2xl font-bold font-mono">{formatNumber(result.asymmetry_g, 4)}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.asymmetry_g > 0.5 ? 'Forward scattering' :
                     result.asymmetry_g > -0.5 ? 'Isotropic' :
                     'Back scattering'}
                  </p>
                </div>
              </div>

              {/* Refractive index used */}
              <div className="mt-4 pt-3 border-t text-xs text-muted-foreground flex justify-between">
                <span>
                  Refractive index: {result.refractive_index.n} + {result.refractive_index.k}i
                </span>
                <span>
                  Medium: {result.medium_index ?? 1.0}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
