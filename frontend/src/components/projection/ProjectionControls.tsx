'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Download, Image, Loader2, Camera } from 'lucide-react'
import { useViewerStore } from '@/stores/viewerStore'

export interface ProjectionParams {
  azimuth: number
  elevation: number
  format: 'png' | 'svg'
}

export interface BatchParams {
  azimuth_start: number
  azimuth_end: number
  azimuth_step: number
  elevation_start: number
  elevation_end: number
  elevation_step: number
  format: 'png' | 'svg'
}

interface ProjectionControlsProps {
  onPreview: (params: ProjectionParams) => void
  onDownloadBatch: (params: BatchParams) => void
  isLoading?: boolean
  isBatchLoading?: boolean
}

export function ProjectionControls({
  onPreview,
  onDownloadBatch,
  isLoading,
  isBatchLoading,
}: ProjectionControlsProps) {
  const { cameraAzimuth, cameraElevation } = useViewerStore()
  const [azimuth, setAzimuth] = useState(45)
  const [elevation, setElevation] = useState(30)
  const [format, setFormat] = useState<'png' | 'svg'>('png')

  const handleProjectCurrentView = () => {
    // Set sliders to current 3D view angles and generate preview
    setAzimuth(cameraAzimuth)
    setElevation(cameraElevation)
    onPreview({ azimuth: cameraAzimuth, elevation: cameraElevation, format })
  }

  // Batch settings
  const [azStart, setAzStart] = useState(0)
  const [azEnd, setAzEnd] = useState(150)
  const [azStep, setAzStep] = useState(30)
  const [elStart, setElStart] = useState(0)
  const [elEnd, setElEnd] = useState(150)
  const [elStep, setElStep] = useState(30)

  const handlePreview = () => {
    onPreview({ azimuth, elevation, format })
  }

  const handleDownloadBatch = () => {
    onDownloadBatch({
      azimuth_start: azStart,
      azimuth_end: azEnd,
      azimuth_step: azStep,
      elevation_start: elStart,
      elevation_end: elEnd,
      elevation_step: elStep,
      format,
    })
  }

  // Calculate number of projections in batch
  const numAz = Math.floor((azEnd - azStart) / azStep) + 1
  const numEl = Math.floor((elEnd - elStart) / elStep) + 1
  const totalProjections = numAz * numEl

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">2D Projection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Preview Controls */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm">Preview Single Projection</h4>

          <div className="space-y-2">
            <Label>Azimuth: {azimuth}°</Label>
            <Slider
              min={0}
              max={360}
              step={5}
              value={[azimuth]}
              onValueChange={([v]) => setAzimuth(v)}
            />
          </div>

          <div className="space-y-2">
            <Label>Elevation: {elevation}°</Label>
            <Slider
              min={-90}
              max={90}
              step={5}
              value={[elevation]}
              onValueChange={([v]) => setElevation(v)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant={format === 'png' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFormat('png')}
            >
              PNG
            </Button>
            <Button
              variant={format === 'svg' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFormat('svg')}
            >
              SVG
            </Button>
          </div>

          <div className="flex gap-2">
            <Button onClick={handlePreview} disabled={isLoading} className="flex-1">
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Image className="h-4 w-4 mr-2" />
              )}
              Preview
            </Button>
            <Button
              onClick={handleProjectCurrentView}
              disabled={isLoading}
              variant="outline"
              className="flex-1"
              title={`Project current 3D view (Az: ${cameraAzimuth}°, El: ${cameraElevation}°)`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Camera className="h-4 w-4 mr-2" />
              )}
              3D View
            </Button>
          </div>
        </div>

        <hr className="border-border" />

        {/* Batch Controls */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm">Batch Download</h4>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Az Start</Label>
              <Input
                type="number"
                value={azStart}
                onChange={(e) => setAzStart(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Az End</Label>
              <Input
                type="number"
                value={azEnd}
                onChange={(e) => setAzEnd(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Az Step</Label>
              <Input
                type="number"
                value={azStep}
                onChange={(e) => setAzStep(Number(e.target.value))}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">El Start</Label>
              <Input
                type="number"
                value={elStart}
                onChange={(e) => setElStart(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">El End</Label>
              <Input
                type="number"
                value={elEnd}
                onChange={(e) => setElEnd(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">El Step</Label>
              <Input
                type="number"
                value={elStep}
                onChange={(e) => setElStep(Number(e.target.value))}
                className="h-8"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {totalProjections} projections will be generated
          </p>

          <Button
            onClick={handleDownloadBatch}
            disabled={isBatchLoading}
            variant="outline"
            className="w-full"
          >
            {isBatchLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download ZIP
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
