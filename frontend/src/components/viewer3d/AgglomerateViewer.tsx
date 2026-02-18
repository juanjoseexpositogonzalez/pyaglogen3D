'use client'

import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, Grid, GizmoHelper, GizmoViewport, Line } from '@react-three/drei'
import { Particles } from './Particles'
import { useViewerStore, backgroundColors } from '@/stores/viewerStore'
import { cn } from '@/lib/utils'
import type { ColorMode } from '@/lib/types'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// Colors for principal axes (similar to coordinate axes but distinguishable)
const PRINCIPAL_AXIS_COLORS = ['#ff6b6b', '#51cf66', '#339af0'] as const

/**
 * Tracks camera position and updates store with azimuth/elevation angles.
 * Must be placed inside Canvas.
 */
function CameraTracker({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const setCameraAngles = useViewerStore((s) => s.setCameraAngles)
  const { camera } = useThree()

  useFrame(() => {
    if (!controlsRef.current) return

    // Get camera position relative to target (origin)
    const target = controlsRef.current.target
    const x = camera.position.x - target.x
    const y = camera.position.y - target.y
    const z = camera.position.z - target.z

    // Calculate distance from target
    const distance = Math.sqrt(x * x + y * y + z * z)
    if (distance === 0) return

    // Convert to spherical coordinates
    // Azimuth: angle in XZ plane from Z axis (0° = looking from +Z, 90° = from +X)
    const azimuth = Math.atan2(x, z) * (180 / Math.PI)
    // Elevation: angle from XZ plane (0° = horizontal, 90° = from top)
    const elevation = Math.asin(y / distance) * (180 / Math.PI)

    // Normalize azimuth to 0-360
    const normalizedAzimuth = azimuth < 0 ? azimuth + 360 : azimuth

    setCameraAngles(
      Math.round(normalizedAzimuth),
      Math.round(elevation)
    )
  })

  return null
}

/**
 * Renders principal axes as colored lines through the center.
 * Each axis is shown as a line from -scale to +scale along the eigenvector direction.
 */
function PrincipalAxes({
  axes,
  scale,
}: {
  axes: [[number, number, number], [number, number, number], [number, number, number]]
  scale: number
}) {
  return (
    <group>
      {axes.map((axis, i) => {
        // Create line from -scale*axis to +scale*axis
        const start: [number, number, number] = [
          -axis[0] * scale,
          -axis[1] * scale,
          -axis[2] * scale,
        ]
        const end: [number, number, number] = [
          axis[0] * scale,
          axis[1] * scale,
          axis[2] * scale,
        ]
        return (
          <Line
            key={i}
            points={[start, end]}
            color={PRINCIPAL_AXIS_COLORS[i]}
            lineWidth={3}
          />
        )
      })}
    </group>
  )
}

interface AgglomerateViewerProps {
  coordinates: number[][]
  radii: number[]
  colorMode?: ColorMode
  coordination?: number[]
  principalAxes?: [[number, number, number], [number, number, number], [number, number, number]]
  className?: string
}

export function AgglomerateViewer({
  coordinates,
  radii,
  colorMode: propColorMode,
  coordination,
  principalAxes,
  className,
}: AgglomerateViewerProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const {
    colorMode: storeColorMode,
    showAxes,
    showGrid,
    showBoundingSphere,
    showPrincipalAxes,
    autoRotate,
    rotateSpeed,
    particleOpacity,
    background,
  } = useViewerStore()

  const colorMode = propColorMode ?? storeColorMode
  const bgColor = backgroundColors[background]

  // Center coordinates and calculate camera position
  const { centeredCoords, cameraPosition, maxRadius } = useMemo(() => {
    if (coordinates.length === 0) {
      return {
        centeredCoords: [],
        cameraPosition: [0, 0, 100] as [number, number, number],
        maxRadius: 1,
      }
    }

    // Calculate center of mass
    let cx = 0, cy = 0, cz = 0
    for (const [x, y, z] of coordinates) {
      cx += x
      cy += y
      cz += z
    }
    cx /= coordinates.length
    cy /= coordinates.length
    cz /= coordinates.length

    // Center the coordinates
    const centered = coordinates.map(([x, y, z]) => [x - cx, y - cy, z - cz])

    // Find max distance from center (bounding sphere radius)
    let maxDist = 0
    for (let i = 0; i < centered.length; i++) {
      const [x, y, z] = centered[i]
      const r = radii[i] || 1
      const dist = Math.sqrt(x * x + y * y + z * z) + r
      maxDist = Math.max(maxDist, dist)
    }

    // Position camera to see the whole agglomerate
    const cameraDist = Math.max(maxDist * 3, 20)

    return {
      centeredCoords: centered,
      cameraPosition: [cameraDist * 0.6, cameraDist * 0.4, cameraDist * 0.8] as [number, number, number],
      maxRadius: maxDist,
    }
  }, [coordinates, radii])

  if (coordinates.length === 0) {
    return (
      <div
        className={cn('w-full h-[500px] rounded-lg flex items-center justify-center', className)}
        style={{ backgroundColor: bgColor }}
      >
        <p className="text-muted-foreground">No geometry data available</p>
      </div>
    )
  }

  return (
    <div
      className={cn('w-full h-[500px] rounded-lg overflow-hidden', className)}
      style={{ backgroundColor: bgColor }}
    >
      <Canvas
        camera={{ position: cameraPosition, fov: 45, near: 0.1, far: maxRadius * 20 }}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={[bgColor]} />

          {/* Lighting - improved for better 3D appearance */}
          <ambientLight intensity={0.5} />
          <directionalLight position={[1, 1, 1]} intensity={0.8} />
          <directionalLight position={[-1, -1, -0.5]} intensity={0.4} />
          <pointLight position={[0, 0, maxRadius * 2]} intensity={0.3} />

          {/* Particles - using centered coordinates */}
          <Particles
            coordinates={centeredCoords}
            radii={radii}
            colorMode={colorMode}
            coordination={coordination}
            opacity={particleOpacity}
          />

          {/* Grid - scaled to agglomerate size */}
          {showGrid && (
            <Grid
              args={[maxRadius * 4, maxRadius * 4]}
              cellSize={maxRadius / 5}
              cellThickness={0.5}
              cellColor="#334155"
              sectionSize={maxRadius}
              sectionThickness={1}
              sectionColor="#475569"
              fadeDistance={maxRadius * 8}
              fadeStrength={1}
              followCamera={false}
              infiniteGrid
            />
          )}

          {/* Bounding sphere - wireframe globe style */}
          {showBoundingSphere && (
            <mesh>
              <sphereGeometry args={[maxRadius, 24, 16]} />
              <meshBasicMaterial
                color="#666666"
                wireframe
                transparent
                opacity={0.6}
              />
            </mesh>
          )}

          {/* Principal axes of inertia */}
          {showPrincipalAxes && principalAxes && (
            <PrincipalAxes axes={principalAxes} scale={maxRadius * 1.2} />
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

          {/* Controls - orbit around center */}
          <OrbitControls
            ref={controlsRef}
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            zoomSpeed={0.8}
            panSpeed={0.8}
            rotateSpeed={0.8}
            minDistance={maxRadius * 0.5}
            maxDistance={maxRadius * 10}
            target={[0, 0, 0]}
            autoRotate={autoRotate}
            autoRotateSpeed={rotateSpeed}
          />

          {/* Track camera position for Az/El display */}
          <CameraTracker controlsRef={controlsRef} />

          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
