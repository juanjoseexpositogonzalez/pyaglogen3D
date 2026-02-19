'use client'

import { Suspense, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { useViewerStore, backgroundColors } from '@/stores/viewerStore'
import { formatNumber } from '@/lib/utils'
import { Shapes, Info } from 'lucide-react'

type ShapeType = 'chain' | 'cross' | 'star' | 'plane' | 'cuboctahedron'

interface ShapeInfo {
  name: string
  df: number
  description: string
  kfFormula: string
  kfAsymptotic: string
}

const SHAPE_INFO: Record<ShapeType, ShapeInfo> = {
  chain: {
    name: 'Linear Chain',
    df: 1,
    description: 'Particles arranged in a straight line',
    kfFormula: 'N / sqrt(3/5 + (N²-1)/3)',
    kfAsymptotic: '√3 ≈ 1.732',
  },
  cross: {
    name: '3D Cross',
    df: 1,
    description: 'Four arms extending from center (2D cross extruded)',
    kfFormula: 'N / sqrt(3/5 + (N²-1)/3)',
    kfAsymptotic: '√3 ≈ 1.732',
  },
  star: {
    name: '3D Star',
    df: 1,
    description: 'Six arms extending along coordinate axes',
    kfFormula: 'N / sqrt(3/5 + (N²-1)/3)',
    kfAsymptotic: '√3 ≈ 1.732',
  },
  plane: {
    name: 'Hexagonal Plane',
    df: 2,
    description: 'Hexagonal close-packed single layer',
    kfFormula: 'N / (3/5 + (5N²-4N-1)/(9N))',
    kfAsymptotic: '9/5 = 1.8',
  },
  cuboctahedron: {
    name: 'Cuboctahedron',
    df: 3,
    description: 'Hexagonal close-packed 3D structure',
    kfFormula: 'N / Rg^Df',
    kfAsymptotic: '~1.0',
  },
}

/**
 * Generate coordinates for a linear chain of spheres.
 */
function generateChain(n: number, r: number = 1): [number, number, number][] {
  const coords: [number, number, number][] = []
  const offset = ((n - 1) * 2 * r) / 2
  for (let i = 0; i < n; i++) {
    coords.push([i * 2 * r - offset, 0, 0])
  }
  return coords
}

/**
 * Generate coordinates for a 3D cross (4 arms in XZ plane).
 */
function generateCross(n: number, r: number = 1): [number, number, number][] {
  const coords: [number, number, number][] = []
  const armsCount = 4
  const particlesPerArm = Math.floor((n - 1) / armsCount)
  const directions: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ]

  // Center particle
  coords.push([0, 0, 0])

  // Arms
  for (let arm = 0; arm < armsCount && coords.length < n; arm++) {
    const [dx, dy, dz] = directions[arm]
    for (let i = 1; i <= particlesPerArm && coords.length < n; i++) {
      coords.push([dx * i * 2 * r, dy * i * 2 * r, dz * i * 2 * r])
    }
  }

  return coords
}

/**
 * Generate coordinates for a 3D star (6 arms along coordinate axes).
 */
function generateStar(n: number, r: number = 1): [number, number, number][] {
  const coords: [number, number, number][] = []
  const armsCount = 6
  const particlesPerArm = Math.floor((n - 1) / armsCount)
  const directions: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ]

  // Center particle
  coords.push([0, 0, 0])

  // Arms
  for (let arm = 0; arm < armsCount && coords.length < n; arm++) {
    const [dx, dy, dz] = directions[arm]
    for (let i = 1; i <= particlesPerArm && coords.length < n; i++) {
      coords.push([dx * i * 2 * r, dy * i * 2 * r, dz * i * 2 * r])
    }
  }

  return coords
}

/**
 * Generate hexagonal close-packed plane.
 */
function generateHCPlane(n: number, r: number = 1): [number, number, number][] {
  const coords: [number, number, number][] = []
  const d = 2 * r // diameter
  const dy = d * Math.sqrt(3) / 2 // row spacing

  // Generate in expanding hexagonal pattern from center
  // Ring 0: center (1 particle)
  // Ring k: 6*k particles
  let ring = 0

  // Center particle
  coords.push([0, 0, 0])

  while (coords.length < n) {
    ring++
    // 6 directions for hexagonal lattice
    const directions = [
      [d, 0],                    // Right
      [d / 2, dy],               // Upper right
      [-d / 2, dy],              // Upper left
      [-d, 0],                   // Left
      [-d / 2, -dy],             // Lower left
      [d / 2, -dy],              // Lower right
    ]

    // Start at rightmost point of ring
    let x = ring * d
    let z = 0

    for (let side = 0; side < 6 && coords.length < n; side++) {
      const [dx, dz] = directions[(side + 2) % 6] // Offset to move along edge
      for (let step = 0; step < ring && coords.length < n; step++) {
        coords.push([x, 0, z])
        x += dx
        z += dz
      }
    }
  }

  return coords.slice(0, n)
}

/**
 * Generate hexagonal close-packed 3D structure (cuboctahedron-like).
 */
function generateCuboctahedron(n: number, r: number = 1): [number, number, number][] {
  const coords: [number, number, number][] = []
  const d = 2 * r
  const layerSpacing = d * Math.sqrt(2 / 3) // HCP layer spacing

  // Generate layers of hexagonal planes
  let layer = 0
  let remaining = n

  while (remaining > 0) {
    // Particles in this layer (hexagonal pattern)
    const rings = layer + 1
    const particlesInLayer = 1 + 3 * rings * (rings - 1) // Hexagonal number
    const toAdd = Math.min(remaining, particlesInLayer)

    // Generate hexagonal layer at this height
    const layerCoords = generateHCPlane(toAdd, r)

    // Offset for HCP stacking (AB or BA pattern)
    const offsetX = (layer % 2 === 0) ? 0 : d / 2
    const offsetZ = (layer % 2 === 0) ? 0 : d * Math.sqrt(3) / 6

    // Positive layer
    if (layer === 0) {
      for (const [x, _, z] of layerCoords) {
        coords.push([x, 0, z])
        remaining--
        if (remaining === 0) break
      }
    } else {
      // Add symmetric layers above and below
      for (const [x, _, z] of layerCoords) {
        if (remaining > 0) {
          coords.push([x + offsetX, layer * layerSpacing, z + offsetZ])
          remaining--
        }
        if (remaining > 0) {
          coords.push([x + offsetX, -layer * layerSpacing, z + offsetZ])
          remaining--
        }
      }
    }

    layer++
    if (layer > 20) break // Safety limit
  }

  return coords.slice(0, n)
}

/**
 * Calculate radius of gyration for a set of coordinates.
 */
function calculateRg(coords: [number, number, number][]): number {
  const n = coords.length
  if (n === 0) return 0

  // Center of mass
  let cx = 0, cy = 0, cz = 0
  for (const [x, y, z] of coords) {
    cx += x
    cy += y
    cz += z
  }
  cx /= n
  cy /= n
  cz /= n

  // Sum of squared distances from COM
  let sumSq = 0
  for (const [x, y, z] of coords) {
    sumSq += (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
  }

  return Math.sqrt(sumSq / n)
}

/**
 * Calculate prefactor kf for Df=1 (linear chain formula).
 */
function calculateKfDf1(n: number): number {
  if (n <= 1) return 1
  return n / Math.sqrt(3 / 5 + (n * n - 1) / 3)
}

/**
 * Calculate prefactor kf for Df=2 (plane formula).
 */
function calculateKfDf2(n: number): number {
  if (n <= 1) return 1
  return n / (3 / 5 + (5 * n * n - 4 * n - 1) / (9 * n))
}

/**
 * Calculate prefactor kf for Df=3.
 */
function calculateKfDf3(n: number, rg: number, r: number = 1): number {
  if (n <= 1 || rg === 0) return 1
  return n / Math.pow(rg / r, 3)
}

interface ShapeViewerProps {
  coords: [number, number, number][]
  bgColor: string
}

function ShapeViewer({ coords, bgColor }: ShapeViewerProps) {
  const maxDist = useMemo(() => {
    let max = 0
    for (const [x, y, z] of coords) {
      const dist = Math.sqrt(x * x + y * y + z * z)
      max = Math.max(max, dist)
    }
    return Math.max(max + 1, 5)
  }, [coords])

  const cameraDist = maxDist * 2.5

  return (
    <Canvas
      camera={{ position: [cameraDist * 0.6, cameraDist * 0.4, cameraDist * 0.8], fov: 45 }}
      gl={{ antialias: true, alpha: false }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={[bgColor]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        <directionalLight position={[-1, -1, -0.5]} intensity={0.4} />

        {coords.map(([x, y, z], i) => (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshStandardMaterial
              color="#3b82f6"
              metalness={0.1}
              roughness={0.3}
            />
          </mesh>
        ))}

        <OrbitControls
          enablePan={true}
          enableZoom={true}
          minDistance={maxDist * 0.5}
          maxDistance={maxDist * 5}
        />
        <Environment preset="studio" />
      </Suspense>
    </Canvas>
  )
}

export function LimitingShapes3D() {
  const [shapeType, setShapeType] = useState<ShapeType>('chain')
  const [particleCount, setParticleCount] = useState(20)

  const background = useViewerStore((state) => state.background)
  const bgColor = backgroundColors[background]

  const coords = useMemo(() => {
    switch (shapeType) {
      case 'chain':
        return generateChain(particleCount)
      case 'cross':
        return generateCross(particleCount)
      case 'star':
        return generateStar(particleCount)
      case 'plane':
        return generateHCPlane(particleCount)
      case 'cuboctahedron':
        return generateCuboctahedron(particleCount)
      default:
        return []
    }
  }, [shapeType, particleCount])

  const rg = useMemo(() => calculateRg(coords), [coords])

  const kf = useMemo(() => {
    const info = SHAPE_INFO[shapeType]
    if (info.df === 1) {
      return calculateKfDf1(particleCount)
    } else if (info.df === 2) {
      return calculateKfDf2(particleCount)
    } else {
      return calculateKfDf3(particleCount, rg)
    }
  }, [shapeType, particleCount, rg])

  const info = SHAPE_INFO[shapeType]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shapes className="h-5 w-5" />
          Reference Shapes for Calibration
        </CardTitle>
        <CardDescription>
          Visualize limiting case geometries (D<sub>f</sub>=1,2,3) and their theoretical prefactors
          for calibrating fractal analysis methods.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="chain" value={shapeType} onValueChange={(v) => setShapeType(v as ShapeType)}>
          <TabsList className="mb-4 flex-wrap h-auto">
            <TabsTrigger value="chain" className="text-xs">
              Chain (D<sub>f</sub>=1)
            </TabsTrigger>
            <TabsTrigger value="cross" className="text-xs">
              Cross (D<sub>f</sub>=1)
            </TabsTrigger>
            <TabsTrigger value="star" className="text-xs">
              Star (D<sub>f</sub>=1)
            </TabsTrigger>
            <TabsTrigger value="plane" className="text-xs">
              Plane (D<sub>f</sub>=2)
            </TabsTrigger>
            <TabsTrigger value="cuboctahedron" className="text-xs">
              3D Packed (D<sub>f</sub>=3)
            </TabsTrigger>
          </TabsList>

          {Object.keys(SHAPE_INFO).map((shape) => (
            <TabsContent key={shape} value={shape} className="mt-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 3D Viewer */}
                <div className="h-[350px] rounded-lg overflow-hidden border" style={{ backgroundColor: bgColor }}>
                  <ShapeViewer coords={coords} bgColor={bgColor} />
                </div>

                {/* Info Panel */}
                <div className="space-y-4">
                  {/* Particle Count Slider */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>Particle Count (N)</Label>
                      <span className="font-mono text-sm">{particleCount}</span>
                    </div>
                    <Slider
                      value={[particleCount]}
                      onValueChange={([v]) => setParticleCount(v)}
                      min={3}
                      max={200}
                      step={1}
                    />
                  </div>

                  {/* Shape Info */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Shape</p>
                      <p className="font-medium">{info.name}</p>
                      <p className="text-xs text-muted-foreground">{info.description}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Fractal Dimension</p>
                        <p className="text-2xl font-bold font-mono">{info.df}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Calculated k<sub>f</sub></p>
                        <p className="text-2xl font-bold font-mono">{formatNumber(kf, 3)}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Radius of Gyration (R<sub>g</sub>/r<sub>p</sub>)</p>
                      <p className="text-lg font-mono">{formatNumber(rg, 3)}</p>
                    </div>

                    <div className="pt-2 border-t">
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <p>k<sub>f</sub> = {info.kfFormula}</p>
                          <p className="mt-1">Asymptotic limit: k<sub>f</sub> → {info.kfAsymptotic}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Verification */}
                  <div className="text-xs text-muted-foreground">
                    <p>Verification: N = k<sub>f</sub> × (R<sub>g</sub>/r<sub>p</sub>)<sup>D<sub>f</sub></sup></p>
                    <p className="font-mono mt-1">
                      {particleCount} ≈ {formatNumber(kf * Math.pow(rg, info.df), 1)}
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
