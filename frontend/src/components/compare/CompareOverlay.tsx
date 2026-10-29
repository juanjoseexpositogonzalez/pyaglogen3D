'use client'

/**
 * Overlay mode for the Compare page (T11, change: visualize-multiple).
 *
 * Renders every sim into a SINGLE r3f Canvas, with each aggregate
 * translated so its own center-of-mass sits at the world origin (R-4).
 * This makes shape differences immediately readable: the user is looking
 * at N aggregates stacked around (0, 0, 0), each in its own palette
 * color, under one set of shared OrbitControls.
 *
 * Mass-proportional centering
 * ---------------------------
 * We compute CoM with weights proportional to particle volume (r³) —
 * matching the agglomerate's physical center of mass rather than the
 * geometric centroid. The latter would drift if the primary-particle
 * radii aren't uniform.
 *
 * Scaling
 * -------
 * Each sim's coordinates and radii are multiplied by
 * `getScaleFactorNm(params)` before centering, so two aggregates with
 * different primary-particle sizes still display in the same real-world
 * nm scale.
 *
 * Legend
 * ------
 * Rendered as plain HTML outside the Canvas (top-right), one row per
 * sim with its palette chip + name. Plain-DOM legends keep the canvas
 * free of text and play nicely with CSS/Tailwind tooling.
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import type { ReactNode } from 'react'

import { Particles } from '@/components/viewer3d/Particles'
import { getScaleFactorNm } from '@/lib/units'
import { cn } from '@/lib/utils'

import type { CompareSim } from './CompareGrid'

interface CompareOverlayProps {
  simulations: CompareSim[]
  /** id → palette color map. */
  colorMap: Record<string, string>
}

/**
 * Mass-proportional center of mass. Weights each coordinate by r³
 * (volume). Returns (0,0,0) for empty clouds so callers can call it
 * unconditionally.
 */
function calculateCenterOfMass(
  coords: number[][],
  radii: number[],
): [number, number, number] {
  if (coords.length === 0) return [0, 0, 0]

  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let totalMass = 0

  for (let i = 0; i < coords.length; i++) {
    const r = radii[i] ?? 1
    const mass = r * r * r // volume-proportional
    sumX += coords[i][0] * mass
    sumY += coords[i][1] * mass
    sumZ += coords[i][2] * mass
    totalMass += mass
  }

  if (totalMass === 0) return [0, 0, 0]
  return [sumX / totalMass, sumY / totalMass, sumZ / totalMass]
}

export function CompareOverlay({
  simulations,
  colorMap,
}: CompareOverlayProps): ReactNode {
  return (
    <div
      data-testid="compare-overlay"
      className={cn(
        'relative h-[600px] w-full overflow-hidden rounded-lg border',
      )}
    >
      <Canvas
        camera={{ position: [10, 10, 10], fov: 50, near: 0.1, far: 10_000 }}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      >
        {/* Lighting — mirrors AgglomerateViewer so overlay particles
            look consistent with grid-mode cells. */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        <directionalLight position={[-1, -1, -0.5]} intensity={0.4} />

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          zoomSpeed={0.8}
          panSpeed={0.8}
          rotateSpeed={0.8}
        />

        {simulations.map((sim) => {
          if (!sim.geometry) return null
          const color = colorMap[sim.id] ?? '#999999'
          const scale = getScaleFactorNm(sim.parameters)

          // Scale first, then center — so CoM is computed in nm space.
          const scaledCoords = sim.geometry.coordinates.map(([x, y, z]) => [
            x * scale,
            y * scale,
            z * scale,
          ])
          const scaledRadii = sim.geometry.radii.map((r) => r * scale)
          const [cx, cy, cz] = calculateCenterOfMass(scaledCoords, scaledRadii)
          const centered = scaledCoords.map(([x, y, z]) => [
            x - cx,
            y - cy,
            z - cz,
          ])

          return (
            <Particles
              key={sim.id}
              coordinates={centered}
              radii={scaledRadii}
              colorMode="uniform"
              uniformColor={color}
            />
          )
        })}
      </Canvas>

      {/* Legend — plain HTML, top-right corner. */}
      <div
        data-testid="compare-overlay-legend"
        className="absolute top-2 right-2 z-10 max-h-[90%] space-y-1 overflow-y-auto rounded border bg-background/90 p-2 text-xs shadow-sm backdrop-blur-sm"
      >
        <div className="mb-1 font-semibold">Legend</div>
        {simulations.map((sim) => {
          const color = colorMap[sim.id] ?? '#999999'
          return (
            <div
              key={sim.id}
              data-testid="compare-overlay-legend-entry"
              data-sim-id={sim.id}
              data-color={color}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="max-w-[120px] truncate">{sim.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
