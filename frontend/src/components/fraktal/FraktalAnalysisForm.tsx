'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  FraktalModel,
  FraktalSourceType,
  CreateFraktalInput,
  SimulationSummary,
} from '@/lib/types'

interface FraktalAnalysisFormProps {
  onSubmit: (data: CreateFraktalInput) => void
  isLoading?: boolean
  simulations?: SimulationSummary[]
}

const modelOptions: { value: FraktalModel; label: string }[] = [
  { value: 'granulated_2012', label: 'Granulated 2012 (Spherical Particles)' },
  { value: 'voxel_2018', label: 'Voxel 2018 (Simplified)' },
]

const sourceOptions: { value: FraktalSourceType; label: string }[] = [
  { value: 'uploaded_image', label: 'Upload Image' },
  { value: 'simulation_projection', label: 'Simulation Projection' },
]

const modelDescriptions: Record<FraktalModel, string> = {
  granulated_2012: 'For soot/agglomerates with spherical primary particles. Accounts for particle overlap and coordination index. Requires primary particle diameter (dpo).',
  voxel_2018: 'Simplified voxel-based analysis without particle overlap considerations. Faster computation, useful for general fractal analysis.',
}

interface FormParams {
  // Source
  source_type: FraktalSourceType
  simulation_id: string
  azimuth: number
  elevation: number
  resolution: number
  // Model
  model: FraktalModel
  // Common parameters
  npix: number
  escala: number
  correction_3d: boolean
  pixel_min: number
  pixel_max: number
  // Granulated 2012 specific
  dpo: number
  delta: number
  npo_limit: number
  auto_calibrate: boolean
  // Voxel 2018 specific
  m_exponent: number
  // Scale calibration helper
  scaleBarPixels: number
  scaleBarNm: number
}

const defaultParams: FormParams = {
  source_type: 'uploaded_image',
  simulation_id: '',
  azimuth: 0,
  elevation: 0,
  resolution: 512,
  model: 'granulated_2012',
  npix: 100.0,  // Default: 100 pixels per 100nm = 1 pixel/nm
  escala: 100.0,
  correction_3d: false,
  pixel_min: 10,
  pixel_max: 240,
  dpo: 40.0,  // More realistic default for TEM images
  delta: 1.1,
  npo_limit: 5,
  auto_calibrate: false,
  m_exponent: 1.0,
  // Scale calibration helper
  scaleBarPixels: 100,  // Default: measure 100 pixels from scale bar
  scaleBarNm: 100,      // Default: 100nm scale bar
}

export function FraktalAnalysisForm({ onSubmit, isLoading, simulations = [] }: FraktalAnalysisFormProps) {
  const [name, setName] = useState<string>('')
  const [params, setParams] = useState<FormParams>(defaultParams)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateParam = <K extends keyof FormParams>(key: K, value: FormParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview)
      }
    }
  }, [imagePreview])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      // Create preview using URL.createObjectURL for better performance
      const objectUrl = URL.createObjectURL(file)
      setImagePreview(objectUrl)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (params.source_type === 'uploaded_image') {
      if (!imageFile) {
        alert('Please select an image file')
        return
      }

      // Convert file to base64
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]

        onSubmit({
          name: name.trim() || undefined,
          source_type: 'uploaded_image',
          image: base64,
          original_filename: imageFile.name,
          original_content_type: imageFile.type,
          model: params.model,
          npix: params.npix,
          dpo: params.model === 'granulated_2012' ? params.dpo : undefined,
          delta: params.delta,
          correction_3d: params.correction_3d,
          pixel_min: params.pixel_min,
          pixel_max: params.pixel_max,
          npo_limit: params.npo_limit,
          escala: params.escala,
          m_exponent: params.m_exponent,
          auto_calibrate: params.model === 'granulated_2012' ? params.auto_calibrate : undefined,
        })
      }
      reader.readAsDataURL(imageFile)
    } else {
      // Simulation projection
      if (!params.simulation_id) {
        alert('Please select a simulation')
        return
      }

      onSubmit({
        name: name.trim() || undefined,
        source_type: 'simulation_projection',
        simulation_id: params.simulation_id,
        projection_params: {
          azimuth: params.azimuth,
          elevation: params.elevation,
          resolution: params.resolution,
        },
        model: params.model,
        npix: params.npix,
        dpo: params.model === 'granulated_2012' ? params.dpo : undefined,
        delta: params.delta,
        correction_3d: params.correction_3d,
        pixel_min: params.pixel_min,
        pixel_max: params.pixel_max,
        npo_limit: params.npo_limit,
        escala: params.escala,
        m_exponent: params.m_exponent,
        auto_calibrate: params.model === 'granulated_2012' ? params.auto_calibrate : undefined,
      })
    }
  }

  const completedSimulations = simulations.filter((s) => s.status === 'completed')

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Analysis Name */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Analysis Name</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              type="text"
              placeholder="Leave empty for auto-generated name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Custom name for this analysis. If left empty, a name will be auto-generated (e.g., "FRAKTAL Voxel 2018 - 2024-02-20 10:30").
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Source Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Image Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={params.source_type}
            onChange={(e) => updateParam('source_type', e.target.value as FraktalSourceType)}
            options={sourceOptions}
          />

          {params.source_type === 'uploaded_image' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Upload Image</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/tiff,image/bmp"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                >
                  {imageFile ? imageFile.name : 'Select Image File'}
                </Button>
              </div>
              {imagePreview && (
                <div className="relative aspect-square w-full max-w-xs mx-auto border rounded-lg overflow-hidden">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="object-contain w-full h-full"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Supported formats: PNG, JPEG, TIFF, BMP. Grayscale images work best.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select Simulation</Label>
                <Select
                  value={params.simulation_id}
                  onChange={(e) => updateParam('simulation_id', e.target.value)}
                  options={[
                    { value: '', label: 'Select a simulation...' },
                    ...completedSimulations.map((sim) => ({
                      value: sim.id,
                      label: `${sim.algorithm.toUpperCase()} - ${new Date(sim.created_at).toLocaleDateString()}`,
                    })),
                  ]}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Azimuth: {params.azimuth}°</Label>
                  <Slider
                    min={0}
                    max={360}
                    step={15}
                    value={[params.azimuth]}
                    onValueChange={([v]) => updateParam('azimuth', v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Elevation: {params.elevation}°</Label>
                  <Slider
                    min={-90}
                    max={90}
                    step={15}
                    value={[params.elevation]}
                    onValueChange={([v]) => updateParam('elevation', v)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="resolution">Resolution (px)</Label>
                <Input
                  id="resolution"
                  type="number"
                  min={128}
                  max={2048}
                  step={64}
                  value={params.resolution}
                  onChange={(e) => updateParam('resolution', parseInt(e.target.value) || 512)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Analysis Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={params.model}
            onChange={(e) => updateParam('model', e.target.value as FraktalModel)}
            options={modelOptions}
          />
          <p className="text-sm text-muted-foreground">
            {modelDescriptions[params.model]}
          </p>
        </CardContent>
      </Card>

      {/* Scale Calibration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Scale Calibration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Scale Bar Calibration Helper */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg space-y-4">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
              📏 Measure your scale bar to calibrate
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="scaleBarPixels">Scale bar length (pixels)</Label>
                <Input
                  id="scaleBarPixels"
                  type="number"
                  min={1}
                  max={2000}
                  step={1}
                  value={params.scaleBarPixels}
                  onChange={(e) => {
                    const pixels = parseInt(e.target.value) || 100
                    updateParam('scaleBarPixels', pixels)
                    // Auto-calculate npix
                    const calculatedNpix = (pixels / params.scaleBarNm) * 100
                    updateParam('npix', Math.round(calculatedNpix * 10) / 10)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Measure the scale bar in your image
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="scaleBarNm">Scale bar value (nm)</Label>
                <Input
                  id="scaleBarNm"
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={params.scaleBarNm}
                  onChange={(e) => {
                    const nm = parseInt(e.target.value) || 100
                    updateParam('scaleBarNm', nm)
                    // Auto-calculate npix
                    const calculatedNpix = (params.scaleBarPixels / nm) * 100
                    updateParam('npix', Math.round(calculatedNpix * 10) / 10)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Value shown on scale bar (e.g., 50, 100)
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-blue-200 dark:border-blue-700">
              <span className="text-sm text-blue-700 dark:text-blue-300">Calculated npix:</span>
              <span className="text-lg font-bold font-mono text-blue-800 dark:text-blue-200">
                {params.npix.toFixed(1)} px/100nm
              </span>
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              = {(params.npix / 100).toFixed(3)} pixels per nm
            </p>
          </div>

          {/* Manual npix override */}
          <div className="space-y-2">
            <Label htmlFor="npix">Pixels per 100nm (npix) - Manual</Label>
            <Input
              id="npix"
              type="number"
              min={0.1}
              max={1000}
              step={0.1}
              value={params.npix}
              onChange={(e) => updateParam('npix', parseFloat(e.target.value) || 100)}
            />
            <p className="text-xs text-muted-foreground">
              You can also enter this value directly if you know it
            </p>
          </div>

          {params.model === 'granulated_2012' && (
            <>
              {/* Auto-calibrate toggle */}
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-amber-700 dark:text-amber-300 font-medium">
                      Auto-calibrate dpo
                    </Label>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      Automatically find optimal primary particle diameter
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={params.auto_calibrate ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateParam('auto_calibrate', !params.auto_calibrate)}
                    className={params.auto_calibrate ? 'bg-amber-600 hover:bg-amber-700' : ''}
                  >
                    {params.auto_calibrate ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
                {params.auto_calibrate && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 border-t border-amber-200 dark:border-amber-700 pt-2">
                    The algorithm will test multiple dpo values (0.5x to 2x of starting point)
                    and select the one with best alignment between calculated and visual particle count.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dpo">
                  Primary Particle Diameter (nm)
                  {params.auto_calibrate && (
                    <span className="text-amber-600 dark:text-amber-400 ml-2 text-xs font-normal">
                      (starting point)
                    </span>
                  )}
                </Label>
                <Input
                  id="dpo"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={params.dpo}
                  onChange={(e) => updateParam('dpo', parseFloat(e.target.value) || 40)}
                />
                <p className="text-xs text-muted-foreground">
                  {params.auto_calibrate
                    ? 'Starting value for auto-calibration. The algorithm will search around this value.'
                    : 'Mean diameter of primary spherical particles. If analysis fails, try the suggested dpo from the error message.'}
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="escala">Scale Reference (nm)</Label>
            <Input
              id="escala"
              type="number"
              min={10}
              max={10000}
              step={10}
              value={params.escala}
              onChange={(e) => updateParam('escala', parseFloat(e.target.value) || 100)}
            />
            <p className="text-xs text-muted-foreground">
              Reference scale in nanometers (default: 100nm)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Model Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Model Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {params.model === 'granulated_2012' && (
            <>
              <div className="space-y-2">
                <Label>Filling Factor (delta): {params.delta.toFixed(2)}</Label>
                <Slider
                  min={1.0}
                  max={1.5}
                  step={0.05}
                  value={[params.delta]}
                  onValueChange={([v]) => updateParam('delta', v)}
                />
                <p className="text-xs text-muted-foreground">
                  Particle filling factor (1.0 = touching, 1.5 = overlapping)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="npo_limit">Minimum Particle Count</Label>
                <Input
                  id="npo_limit"
                  type="number"
                  min={1}
                  max={1000}
                  value={params.npo_limit}
                  onChange={(e) => updateParam('npo_limit', parseInt(e.target.value) || 5)}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum number of primary particles for valid analysis
                </p>
              </div>
            </>
          )}

          {params.model === 'voxel_2018' && (
            <div className="space-y-2">
              <Label>m Exponent: {params.m_exponent.toFixed(2)}</Label>
              <Slider
                min={0.5}
                max={2.0}
                step={0.1}
                value={[params.m_exponent]}
                onValueChange={([v]) => updateParam('m_exponent', v)}
              />
              <p className="text-xs text-muted-foreground">
                Exponent for zp calculation in voxel model
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label>3D Correction</Label>
            <Button
              type="button"
              variant={params.correction_3d ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateParam('correction_3d', !params.correction_3d)}
            >
              {params.correction_3d ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Apply 3D correction to radius of gyration (Rg)
          </p>
        </CardContent>
      </Card>

      {/* Segmentation Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Segmentation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pixel_min">Min Pixel Value</Label>
              <Input
                id="pixel_min"
                type="number"
                min={0}
                max={255}
                value={params.pixel_min}
                onChange={(e) => updateParam('pixel_min', parseInt(e.target.value) || 10)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pixel_max">Max Pixel Value</Label>
              <Input
                id="pixel_max"
                type="number"
                min={0}
                max={255}
                value={params.pixel_max}
                onChange={(e) => updateParam('pixel_max', parseInt(e.target.value) || 240)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Pixel intensity range for color segmentation (0-255). Pixels within this range are considered part of the agglomerate.
          </p>
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Running Analysis...' : 'Run FRAKTAL Analysis'}
      </Button>
    </form>
  )
}
