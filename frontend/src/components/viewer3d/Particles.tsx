'use client'

import { useRef, useMemo, useEffect } from 'react'
import * as THREE from 'three'
import type { ColorMode } from '@/lib/types'

interface ParticlesProps {
  coordinates: number[][]
  radii: number[]
  colorMode: ColorMode
  coordination?: number[]
  opacity?: number
}

export function Particles({
  coordinates,
  radii,
  colorMode,
  coordination,
  opacity = 1,
}: ParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const count = coordinates.length

  const { matrices, colors } = useMemo(() => {
    if (count === 0) return { matrices: [], colors: [] }

    const matrices: THREE.Matrix4[] = []
    const colors: THREE.Color[] = []

    const tempMatrix = new THREE.Matrix4()
    const tempPosition = new THREE.Vector3()
    const tempScale = new THREE.Vector3()
    const tempQuaternion = new THREE.Quaternion()

    // Calculate center of mass for distance coloring
    let cx = 0, cy = 0, cz = 0
    for (const [x, y, z] of coordinates) {
      cx += x
      cy += y
      cz += z
    }
    cx /= count
    cy /= count
    cz /= count

    // Calculate max distance for normalization
    let maxDist = 0
    for (const [x, y, z] of coordinates) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
      maxDist = Math.max(maxDist, dist)
    }
    maxDist = maxDist || 1 // Avoid division by zero

    // Calculate z range for depth coloring
    const zValues = coordinates.map((c) => c[2])
    const minZ = Math.min(...zValues)
    const maxZ = Math.max(...zValues)
    const zRange = maxZ - minZ || 1

    for (let i = 0; i < count; i++) {
      const [x, y, z] = coordinates[i]
      const r = radii[i]

      tempPosition.set(x, y, z)
      tempScale.set(r, r, r)
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale)
      matrices.push(tempMatrix.clone())

      // Color based on mode
      const color = new THREE.Color()
      switch (colorMode) {
        case 'order':
          color.setHSL((i / count) * 0.8, 0.7, 0.5)
          break
        case 'coordination':
          const coord = coordination?.[i] ?? 0
          // Blue (high coordination) to red (low coordination)
          color.setHSL(0.6 - (coord / 12) * 0.5, 0.8, 0.5)
          break
        case 'distance': {
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
          // Purple (center) to yellow (edge)
          color.setHSL((dist / maxDist) * 0.15 + 0.75, 0.7, 0.5)
          break
        }
        case 'depth': {
          const normalizedZ = (z - minZ) / zRange
          // Red (front) to blue (back)
          color.setHSL(normalizedZ * 0.6, 0.7, 0.5)
          break
        }
        default:
          // Uniform blue
          color.setHex(0x4488ff)
      }
      colors.push(color)
    }

    return { matrices, colors }
  }, [coordinates, radii, colorMode, coordination, count])

  // Apply transforms and colors when they change
  useEffect(() => {
    if (!meshRef.current || matrices.length === 0) return

    for (let i = 0; i < matrices.length; i++) {
      meshRef.current.setMatrixAt(i, matrices[i])
      meshRef.current.setColorAt(i, colors[i])
    }
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  }, [matrices, colors])

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      castShadow
      receiveShadow
    >
      {/* Higher resolution spheres like Matlab's sphere(30) */}
      <sphereGeometry args={[1, 32, 32]} />
      <meshPhongMaterial
        color="#ffffff"
        shininess={80}
        specular="#444444"
        transparent={opacity < 1}
        opacity={opacity}
      />
    </instancedMesh>
  )
}
