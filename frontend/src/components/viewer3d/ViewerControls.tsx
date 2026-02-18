'use client'

import { useViewerStore, type BackgroundPreset } from '@/stores/viewerStore'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Grid3X3,
  Axis3D,
  RotateCcw,
  Play,
  Pause,
  Compass,
  Circle,
  Move3D,
} from 'lucide-react'
import type { ColorMode } from '@/lib/types'

const colorModeOptions: { value: ColorMode; label: string }[] = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'order', label: 'Deposition Order' },
  { value: 'distance', label: 'Distance from Center' },
  { value: 'depth', label: 'Depth (Z)' },
  { value: 'coordination', label: 'Coordination Number' },
]

const backgroundOptions: { value: BackgroundPreset; label: string }[] = [
  { value: 'dark', label: 'Dark Blue' },
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
]

export function ViewerControls() {
  const {
    colorMode,
    setColorMode,
    showAxes,
    toggleAxes,
    showGrid,
    toggleGrid,
    showBoundingSphere,
    toggleBoundingSphere,
    showPrincipalAxes,
    togglePrincipalAxes,
    autoRotate,
    toggleAutoRotate,
    rotateSpeed,
    setRotateSpeed,
    particleOpacity,
    setParticleOpacity,
    background,
    setBackground,
    cameraAzimuth,
    cameraElevation,
    reset,
  } = useViewerStore()

  return (
    <div className="space-y-4 p-4 bg-card rounded-lg border">
      <h3 className="font-semibold text-sm">Viewer Controls</h3>

      {/* Camera Position (Az/El) */}
      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
        <Compass className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-3 text-sm">
          <span>Az: <span className="font-mono font-medium">{cameraAzimuth}°</span></span>
          <span>El: <span className="font-mono font-medium">{cameraElevation}°</span></span>
        </div>
      </div>

      {/* Color Mode */}
      <div className="space-y-2">
        <Label>Color Mode</Label>
        <Select
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as ColorMode)}
          options={colorModeOptions}
        />
      </div>

      {/* Background */}
      <div className="space-y-2">
        <Label>Background</Label>
        <Select
          value={background}
          onChange={(e) => setBackground(e.target.value as BackgroundPreset)}
          options={backgroundOptions}
        />
      </div>

      {/* Opacity */}
      <div className="space-y-2">
        <Label>Opacity: {(particleOpacity * 100).toFixed(0)}%</Label>
        <Slider
          min={0.1}
          max={1}
          step={0.1}
          value={[particleOpacity]}
          onValueChange={([v]) => setParticleOpacity(v)}
        />
      </div>

      {/* Rotation Speed */}
      <div className="space-y-2">
        <Label>Rotation Speed: {rotateSpeed.toFixed(1)}x</Label>
        <Slider
          min={0.5}
          max={5}
          step={0.5}
          value={[rotateSpeed]}
          onValueChange={([v]) => setRotateSpeed(v)}
        />
      </div>

      {/* Toggle Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={showAxes ? 'default' : 'outline'}
          size="sm"
          onClick={toggleAxes}
        >
          <Axis3D className="h-4 w-4 mr-1" />
          Axes
        </Button>

        <Button
          variant={showGrid ? 'default' : 'outline'}
          size="sm"
          onClick={toggleGrid}
        >
          <Grid3X3 className="h-4 w-4 mr-1" />
          Grid
        </Button>

        <Button
          variant={showBoundingSphere ? 'default' : 'outline'}
          size="sm"
          onClick={toggleBoundingSphere}
        >
          <Circle className="h-4 w-4 mr-1" />
          Sphere
        </Button>

        <Button
          variant={showPrincipalAxes ? 'default' : 'outline'}
          size="sm"
          onClick={togglePrincipalAxes}
          title="Show principal axes of inertia"
        >
          <Move3D className="h-4 w-4 mr-1" />
          Inertia
        </Button>

        <Button
          variant={autoRotate ? 'default' : 'outline'}
          size="sm"
          onClick={toggleAutoRotate}
        >
          {autoRotate ? (
            <Pause className="h-4 w-4 mr-1" />
          ) : (
            <Play className="h-4 w-4 mr-1" />
          )}
          Rotate
        </Button>

        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Reset
        </Button>
      </div>
    </div>
  )
}
