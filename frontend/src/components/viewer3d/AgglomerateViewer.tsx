'use client'

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { Particles } from './Particles'
import { useViewerStore } from '@/stores/viewerStore'
import { cn } from '@/lib/utils'
import type { ColorMode } from '@/lib/types'

interface AgglomerateViewerProps {
  coordinates: number[][]
  radii: number[]
  colorMode?: ColorMode
  coordination?: number[]
  className?: string
}

export function AgglomerateViewer({
  coordinates,
  radii,
  colorMode: propColorMode,
  coordination,
  className,
}: AgglomerateViewerProps) {
  const {
    colorMode: storeColorMode,
    showAxes,
    showGrid,
    autoRotate,
    rotateSpeed,
    particleOpacity,
  } = useViewerStore()

  const colorMode = propColorMode ?? storeColorMode

  // Calculate camera position based on aggregate size
  const cameraPosition = useMemo(() => {
    if (coordinates.length === 0) return [0, 0, 100] as [number, number, number]

    // Find bounding box
    let maxDist = 0
    for (const [x, y, z] of coordinates) {
      const dist = Math.sqrt(x * x + y * y + z * z)
      maxDist = Math.max(maxDist, dist)
    }

    // Position camera at 2.5x the max distance
    const cameraDist = Math.max(maxDist * 2.5, 50)
    return [cameraDist * 0.7, cameraDist * 0.5, cameraDist] as [number, number, number]
  }, [coordinates])

  if (coordinates.length === 0) {
    return (
      <div className={cn('w-full h-[500px] bg-slate-900 rounded-lg flex items-center justify-center', className)}>
        <p className="text-muted-foreground">No geometry data available</p>
      </div>
    )
  }

  return (
    <div className={cn('w-full h-[500px] bg-slate-900 rounded-lg overflow-hidden', className)}>
      <Canvas
        camera={{ position: cameraPosition, fov: 50 }}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={['#0f172a']} />

          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 10]} intensity={0.8} />
          <directionalLight position={[-10, -10, -5]} intensity={0.3} />

          {/* Particles */}
          <Particles
            coordinates={coordinates}
            radii={radii}
            colorMode={colorMode}
            coordination={coordination}
            opacity={particleOpacity}
          />

          {/* Grid */}
          {showGrid && (
            <Grid
              args={[200, 200]}
              cellSize={10}
              cellThickness={0.5}
              cellColor="#334155"
              sectionSize={50}
              sectionThickness={1}
              sectionColor="#475569"
              fadeDistance={400}
              fadeStrength={1}
              followCamera={false}
              infiniteGrid
            />
          )}

          {/* Axes helper via GizmoHelper */}
          {showAxes && (
            <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
              <GizmoViewport
                axisColors={['#ef4444', '#22c55e', '#3b82f6']}
                labelColor="white"
              />
            </GizmoHelper>
          )}

          {/* Controls */}
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            zoomSpeed={0.5}
            autoRotate={autoRotate}
            autoRotateSpeed={rotateSpeed}
          />

          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
