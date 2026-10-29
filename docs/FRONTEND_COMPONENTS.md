# Frontend Components - pyAgloGen3D

## Technology Stack

| Technology | Purpose |
|------------|---------|
| Next.js 14+ | React framework with App Router |
| React Three Fiber | 3D visualization (WebGL) |
| Drei | R3F helpers and controls |
| Plotly.js | 2D scientific charts |
| TanStack Query | Server state management |
| Zustand | Client state management |
| Tailwind CSS | Utility-first styling |
| shadcn/ui | UI component library |
| TypeScript | Type safety |

---

## Project Structure

```
frontend/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Landing
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── projects/
│   │   │   ├── page.tsx              # List projects
│   │   │   ├── [id]/
│   │   │   │   ├── page.tsx          # Project detail
│   │   │   │   ├── simulations/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── new/page.tsx
│   │   │   │   │   └── [simId]/page.tsx
│   │   │   │   └── analyses/
│   │   │   │       ├── page.tsx
│   │   │   │       ├── new/page.tsx
│   │   │   │       └── [analysisId]/page.tsx
│   │   │   └── new/page.tsx
│   │   └── api/                      # API routes (if needed)
│   ├── components/
│   │   ├── viewer3d/                 # 3D visualization
│   │   │   ├── AgglomerateViewer.tsx
│   │   │   ├── Particles.tsx
│   │   │   ├── Controls.tsx
│   │   │   ├── ColorModes.tsx
│   │   │   ├── ClippingPlane.tsx
│   │   │   └── ExportDialog.tsx
│   │   ├── charts/                   # 2D charts
│   │   │   ├── LogLogPlot.tsx
│   │   │   ├── RDFChart.tsx
│   │   │   ├── HistogramChart.tsx
│   │   │   ├── DqSpectrum.tsx
│   │   │   └── RgEvolution.tsx
│   │   ├── forms/                    # Parameter forms
│   │   │   ├── DlaForm.tsx
│   │   │   ├── CcaForm.tsx
│   │   │   ├── BallisticForm.tsx
│   │   │   ├── PreprocessingForm.tsx
│   │   │   ├── BoxCountingForm.tsx
│   │   │   └── ParametricStudyForm.tsx
│   │   ├── ui/                       # shadcn components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── table.tsx
│   │   │   └── tabs.tsx
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Footer.tsx
│   │   └── common/
│   │       ├── StatusBadge.tsx
│   │       ├── MetricsCard.tsx
│   │       ├── ImageUpload.tsx
│   │       └── LoadingSpinner.tsx
│   ├── lib/
│   │   ├── api.ts                    # API client
│   │   ├── types.ts                  # TypeScript types
│   │   └── utils.ts                  # Utilities
│   ├── hooks/
│   │   ├── useSimulation.ts
│   │   ├── useAnalysis.ts
│   │   ├── useProject.ts
│   │   └── usePolling.ts
│   └── stores/
│       ├── viewerStore.ts            # 3D viewer state
│       └── uiStore.ts                # UI preferences
└── public/
    └── ...
```

---

## Core Components

### AgglomerateViewer

3D viewer for particle agglomerates using React Three Fiber.

```tsx
// components/viewer3d/AgglomerateViewer.tsx

import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { Particles } from './Particles'
import { ClippingPlane } from './ClippingPlane'
import { useViewerStore } from '@/stores/viewerStore'

interface AgglomerateViewerProps {
  coordinates: number[][]  // [x, y, z][]
  radii: number[]
  colorMode?: 'uniform' | 'order' | 'coordination' | 'distance' | 'depth'
  coordination?: number[]
  className?: string
}

export function AgglomerateViewer({
  coordinates,
  radii,
  colorMode = 'uniform',
  coordination,
  className
}: AgglomerateViewerProps) {
  const { showClipping, clippingPosition } = useViewerStore()

  return (
    <div className={cn("w-full h-[600px] bg-slate-900 rounded-lg", className)}>
      <Canvas
        camera={{ position: [0, 0, 300], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 10]} intensity={0.8} />
        <directionalLight position={[-10, -10, -5]} intensity={0.3} />

        <Particles
          coordinates={coordinates}
          radii={radii}
          colorMode={colorMode}
          coordination={coordination}
        />

        {showClipping && (
          <ClippingPlane position={clippingPosition} />
        )}

        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          zoomSpeed={0.5}
        />

        <Environment preset="studio" />
      </Canvas>
    </div>
  )
}
```

### Particles (Instanced Rendering)

Efficient rendering of thousands of spheres using instanced meshes.

```tsx
// components/viewer3d/Particles.tsx

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface ParticlesProps {
  coordinates: number[][]
  radii: number[]
  colorMode: string
  coordination?: number[]
}

export function Particles({
  coordinates,
  radii,
  colorMode,
  coordination
}: ParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const { matrices, colors } = useMemo(() => {
    const count = coordinates.length
    const matrices: THREE.Matrix4[] = []
    const colors: THREE.Color[] = []

    const tempMatrix = new THREE.Matrix4()
    const tempPosition = new THREE.Vector3()
    const tempScale = new THREE.Vector3()
    const tempQuaternion = new THREE.Quaternion()

    // Calculate center of mass for distance coloring
    let cx = 0, cy = 0, cz = 0
    for (const [x, y, z] of coordinates) {
      cx += x; cy += y; cz += z
    }
    cx /= count; cy /= count; cz /= count

    const maxDist = Math.max(...coordinates.map(([x, y, z]) =>
      Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
    ))

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
          color.setHSL(i / count * 0.8, 0.7, 0.5)
          break
        case 'coordination':
          const coord = coordination?.[i] ?? 0
          color.setHSL(0.6 - (coord / 12) * 0.5, 0.8, 0.5)
          break
        case 'distance':
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
          color.setHSL(dist / maxDist * 0.7, 0.7, 0.5)
          break
        case 'depth':
          const normalizedZ = (z - Math.min(...coordinates.map(c => c[2]))) /
            (Math.max(...coordinates.map(c => c[2])) - Math.min(...coordinates.map(c => c[2])))
          color.setHSL(normalizedZ * 0.3, 0.6, 0.5)
          break
        default:
          color.setHex(0x4488ff)
      }
      colors.push(color)
    }

    return { matrices, colors }
  }, [coordinates, radii, colorMode, coordination])

  // Apply transforms and colors
  useMemo(() => {
    if (!meshRef.current) return

    for (let i = 0; i < matrices.length; i++) {
      meshRef.current.setMatrixAt(i, matrices[i])
      meshRef.current.setColorAt(i, colors[i])
    }
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  }, [matrices, colors])

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, coordinates.length]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial
        roughness={0.3}
        metalness={0.1}
      />
    </instancedMesh>
  )
}
```

### LogLogPlot

Scientific log-log plot for fractal analysis using Plotly.

```tsx
// components/charts/LogLogPlot.tsx

import dynamic from 'next/dynamic'
import { useMemo } from 'react'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface LogLogPlotProps {
  xData: number[]
  yData: number[]
  xLabel?: string
  yLabel?: string
  title?: string
  fitLine?: {
    slope: number
    intercept: number
  }
  rSquared?: number
  className?: string
}

export function LogLogPlot({
  xData,
  yData,
  xLabel = 'log(size)',
  yLabel = 'log(count)',
  title = 'Log-Log Plot',
  fitLine,
  rSquared,
  className
}: LogLogPlotProps) {
  const data = useMemo(() => {
    const traces: Plotly.Data[] = [
      {
        x: xData,
        y: yData,
        mode: 'markers',
        type: 'scatter',
        name: 'Data',
        marker: {
          color: '#4488ff',
          size: 8
        }
      }
    ]

    if (fitLine) {
      const xMin = Math.min(...xData)
      const xMax = Math.max(...xData)
      traces.push({
        x: [xMin, xMax],
        y: [
          fitLine.slope * xMin + fitLine.intercept,
          fitLine.slope * xMax + fitLine.intercept
        ],
        mode: 'lines',
        type: 'scatter',
        name: `Fit (slope = ${fitLine.slope.toFixed(3)})`,
        line: {
          color: '#ff4444',
          width: 2,
          dash: 'dash'
        }
      })
    }

    return traces
  }, [xData, yData, fitLine])

  const layout: Partial<Plotly.Layout> = {
    title: {
      text: rSquared ? `${title} (R² = ${rSquared.toFixed(4)})` : title,
      font: { size: 14 }
    },
    xaxis: {
      title: xLabel,
      gridcolor: '#333',
      zerolinecolor: '#555'
    },
    yaxis: {
      title: yLabel,
      gridcolor: '#333',
      zerolinecolor: '#555'
    },
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#0f172a',
    font: { color: '#e2e8f0' },
    legend: {
      x: 0.02,
      y: 0.98,
      bgcolor: 'rgba(0,0,0,0.5)'
    },
    margin: { t: 50, r: 30, b: 50, l: 60 }
  }

  return (
    <div className={className}>
      <Plot
        data={data}
        layout={layout}
        config={{ responsive: true }}
        style={{ width: '100%', height: '400px' }}
      />
    </div>
  )
}
```

### DlaForm

Form for configuring DLA simulation parameters.

```tsx
// components/forms/DlaForm.tsx

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const dlaSchema = z.object({
  n_particles: z.number().int().min(10).max(100000),
  sticking_probability: z.number().min(0).max(1),
  lattice_size: z.number().int().min(50).max(2000),
  seed_radius: z.number().min(0.1).max(10),
  seed: z.number().int().optional(),
})

type DlaFormData = z.infer<typeof dlaSchema>

interface DlaFormProps {
  onSubmit: (data: DlaFormData) => void
  isLoading?: boolean
  defaultValues?: Partial<DlaFormData>
}

export function DlaForm({
  onSubmit,
  isLoading,
  defaultValues
}: DlaFormProps) {
  const form = useForm<DlaFormData>({
    resolver: zodResolver(dlaSchema),
    defaultValues: {
      n_particles: 1000,
      sticking_probability: 1.0,
      lattice_size: 200,
      seed_radius: 1.0,
      ...defaultValues
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="n_particles"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Number of Particles</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Total particles in the agglomerate (10 - 100,000)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sticking_probability"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Sticking Probability: {field.value.toFixed(2)}
              </FormLabel>
              <FormControl>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[field.value]}
                  onValueChange={([v]) => field.onChange(v)}
                />
              </FormControl>
              <FormDescription>
                Probability of adhesion on contact (0 = never, 1 = always)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="lattice_size"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lattice Size</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Size of the simulation domain (50 - 2000)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="seed"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Random Seed (optional)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="Leave empty for random"
                  {...field}
                  onChange={(e) => {
                    const val = e.target.value
                    field.onChange(val ? parseInt(val) : undefined)
                  }}
                />
              </FormControl>
              <FormDescription>
                For reproducible simulations
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'Starting Simulation...' : 'Run Simulation'}
        </Button>
      </form>
    </Form>
  )
}
```

### ImageUpload with Preview

Drag-and-drop image upload with preprocessing preview.

```tsx
// components/common/ImageUpload.tsx

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageUploadProps {
  onUpload: (file: File) => Promise<string>
  onImageSelected: (imagePath: string) => void
  className?: string
}

export function ImageUpload({
  onUpload,
  onImageSelected,
  className
}: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    // Validate
    if (!['image/png', 'image/jpeg', 'image/tiff', 'image/bmp'].includes(file.type)) {
      setError('Invalid file type. Supported: PNG, JPEG, TIFF, BMP')
      return
    }

    if (file.size > 50 * 1024 * 1024) {
      setError('File too large. Maximum: 50MB')
      return
    }

    setError(null)
    setIsUploading(true)

    // Show local preview
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)

    try {
      const imagePath = await onUpload(file)
      onImageSelected(imagePath)
    } catch (err) {
      setError('Upload failed. Please try again.')
      setPreview(null)
    } finally {
      setIsUploading(false)
    }
  }, [onUpload, onImageSelected])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/tiff': ['.tiff', '.tif'],
      'image/bmp': ['.bmp']
    },
    maxFiles: 1
  })

  const clearPreview = () => {
    setPreview(null)
    setError(null)
  }

  return (
    <div className={cn("space-y-4", className)}>
      {preview ? (
        <div className="relative">
          <img
            src={preview}
            alt="Preview"
            className="w-full max-h-[400px] object-contain rounded-lg border border-slate-700"
          />
          <button
            onClick={clearPreview}
            className="absolute top-2 right-2 p-1 bg-red-600 rounded-full hover:bg-red-700"
          >
            <X className="w-4 h-4" />
          </button>
          {isUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
            </div>
          )}
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive
              ? "border-blue-500 bg-blue-500/10"
              : "border-slate-600 hover:border-slate-500",
            error && "border-red-500"
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2">
            {isDragActive ? (
              <>
                <Upload className="w-10 h-10 text-blue-500" />
                <p className="text-blue-500">Drop the image here</p>
              </>
            ) : (
              <>
                <ImageIcon className="w-10 h-10 text-slate-400" />
                <p className="text-slate-300">
                  Drag & drop an image, or click to select
                </p>
                <p className="text-sm text-slate-500">
                  PNG, JPEG, TIFF, BMP (max 50MB)
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
    </div>
  )
}
```

---

## State Management

### Viewer Store (Zustand)

```tsx
// stores/viewerStore.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ColorMode = 'uniform' | 'order' | 'coordination' | 'distance' | 'depth'

interface ViewerState {
  // Display settings
  colorMode: ColorMode
  showAxes: boolean
  showGrid: boolean

  // Clipping
  showClipping: boolean
  clippingPosition: [number, number, number]
  clippingNormal: [number, number, number]

  // Camera
  autoRotate: boolean
  rotateSpeed: number

  // Actions
  setColorMode: (mode: ColorMode) => void
  toggleAxes: () => void
  toggleGrid: () => void
  toggleClipping: () => void
  setClippingPosition: (pos: [number, number, number]) => void
  toggleAutoRotate: () => void
  resetCamera: () => void
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set) => ({
      // Initial state
      colorMode: 'uniform',
      showAxes: true,
      showGrid: false,
      showClipping: false,
      clippingPosition: [0, 0, 0],
      clippingNormal: [1, 0, 0],
      autoRotate: false,
      rotateSpeed: 1,

      // Actions
      setColorMode: (mode) => set({ colorMode: mode }),
      toggleAxes: () => set((s) => ({ showAxes: !s.showAxes })),
      toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
      toggleClipping: () => set((s) => ({ showClipping: !s.showClipping })),
      setClippingPosition: (pos) => set({ clippingPosition: pos }),
      toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
      resetCamera: () => {
        // Trigger camera reset via ref
      }
    }),
    {
      name: 'viewer-settings'
    }
  )
)
```

### API Client

```tsx
// lib/api.ts

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.message || `Request failed: ${res.status}`)
  }

  return res.json()
}

// Projects
export const projectsApi = {
  list: () => request<Project[]>('/projects/'),
  get: (id: string) => request<Project>(`/projects/${id}/`),
  create: (data: CreateProject) =>
    request<Project>('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request(`/projects/${id}/`, { method: 'DELETE' }),
}

// Simulations
export const simulationsApi = {
  list: (projectId: string, params?: SimulationFilters) => {
    const query = new URLSearchParams(params as any).toString()
    return request<PaginatedResponse<Simulation>>(
      `/projects/${projectId}/simulations/?${query}`
    )
  },
  get: (projectId: string, id: string) =>
    request<SimulationDetail>(`/projects/${projectId}/simulations/${id}/`),
  create: (projectId: string, data: CreateSimulation) =>
    request<Simulation>(`/projects/${projectId}/simulations/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getGeometry: async (id: string): Promise<Float64Array> => {
    const res = await fetch(`${API_BASE}/simulations/${id}/geometry/`)
    const buffer = await res.arrayBuffer()
    return new Float64Array(buffer)
  },
}

// Image Analyses
export const analysesApi = {
  upload: async (file: File): Promise<{ image_path: string }> => {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`${API_BASE}/upload/`, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) throw new Error('Upload failed')
    return res.json()
  },
  list: (projectId: string) =>
    request<PaginatedResponse<ImageAnalysis>>(
      `/projects/${projectId}/analyses/`
    ),
  get: (projectId: string, id: string) =>
    request<ImageAnalysisDetail>(`/projects/${projectId}/analyses/${id}/`),
  create: (projectId: string, data: CreateAnalysis) =>
    request<ImageAnalysis>(`/projects/${projectId}/analyses/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
```

---

## TypeScript Types

```tsx
// lib/types.ts

export interface Project {
  id: string
  name: string
  description: string | null
  simulation_count: number
  analysis_count: number
  created_at: string
  updated_at: string
}

export type SimulationAlgorithm = 'dla' | 'cca' | 'ballistic' | 'tunable'
export type SimulationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Simulation {
  id: string
  algorithm: SimulationAlgorithm
  status: SimulationStatus
  parameters: DlaParams | CcaParams | BallisticParams
  seed: number
  metrics: SimulationMetrics | null
  execution_time_ms: number | null
  created_at: string
  completed_at: string | null
}

export interface SimulationMetrics {
  fractal_dimension: number
  fractal_dimension_std: number
  prefactor: number
  radius_of_gyration: number
  porosity: number
  coordination: {
    mean: number
    std: number
    histogram: number[]
  }
  rdf: {
    r: number[]
    g_r: number[]
  }
  rg_evolution: {
    n: number[]
    rg: number[]
  }
}

export interface DlaParams {
  n_particles: number
  sticking_probability: number
  lattice_size: number
  seed_radius: number
}

export type FractalMethod = 'box_counting' | 'sandbox' | 'correlation' | 'lacunarity' | 'multifractal'
export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ImageAnalysis {
  id: string
  original_image_path: string
  processed_image_path: string | null
  method: FractalMethod
  status: AnalysisStatus
  results: BoxCountingResults | MultifractalResults | null
  created_at: string
  completed_at: string | null
}

export interface BoxCountingResults {
  fractal_dimension: number
  r_squared: number
  std_error: number
  confidence_interval_95: [number, number]
  log_sizes: number[]
  log_counts: number[]
  residuals: number[]
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
```

---

## Hooks

### useSimulation

```tsx
// hooks/useSimulation.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { simulationsApi } from '@/lib/api'
import { useEffect } from 'react'

export function useSimulation(projectId: string, simulationId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['simulation', projectId, simulationId],
    queryFn: () => simulationsApi.get(projectId, simulationId),
    refetchInterval: (data) => {
      // Poll while running
      if (data?.status === 'queued' || data?.status === 'running') {
        return 2000
      }
      return false
    }
  })

  return query
}

export function useCreateSimulation(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateSimulation) =>
      simulationsApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['simulations', projectId]
      })
    }
  })
}

export function useSimulationGeometry(simulationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['geometry', simulationId],
    queryFn: () => simulationsApi.getGeometry(simulationId),
    enabled,
    staleTime: Infinity // Geometry doesn't change
  })
}
```

---

## Page Examples

### Simulation Detail Page

```tsx
// app/projects/[id]/simulations/[simId]/page.tsx

'use client'

import { useParams } from 'next/navigation'
import { useSimulation, useSimulationGeometry } from '@/hooks/useSimulation'
import { AgglomerateViewer } from '@/components/viewer3d/AgglomerateViewer'
import { LogLogPlot } from '@/components/charts/LogLogPlot'
import { RDFChart } from '@/components/charts/RDFChart'
import { HistogramChart } from '@/components/charts/HistogramChart'
import { MetricsCard } from '@/components/common/MetricsCard'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SimulationDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const simulationId = params.simId as string

  const { data: simulation, isLoading } = useSimulation(projectId, simulationId)
  const { data: geometry } = useSimulationGeometry(
    simulationId,
    simulation?.status === 'completed'
  )

  if (isLoading) return <LoadingSpinner />
  if (!simulation) return <NotFound />

  const coordinates = geometry
    ? Array.from({ length: geometry.length / 4 }, (_, i) => [
        geometry[i * 4],
        geometry[i * 4 + 1],
        geometry[i * 4 + 2]
      ])
    : []

  const radii = geometry
    ? Array.from({ length: geometry.length / 4 }, (_, i) => geometry[i * 4 + 3])
    : []

  return (
    <div className="container mx-auto py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {simulation.algorithm.toUpperCase()} Simulation
          </h1>
          <p className="text-slate-400">
            {simulation.parameters.n_particles.toLocaleString()} particles
          </p>
        </div>
        <StatusBadge status={simulation.status} />
      </div>

      {simulation.status === 'completed' && simulation.metrics && (
        <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricsCard
              label="Fractal Dimension"
              value={simulation.metrics.fractal_dimension.toFixed(3)}
              subvalue={`+/- ${simulation.metrics.fractal_dimension_std.toFixed(3)}`}
            />
            <MetricsCard
              label="Prefactor (kf)"
              value={simulation.metrics.prefactor.toFixed(3)}
            />
            <MetricsCard
              label="Radius of Gyration"
              value={simulation.metrics.radius_of_gyration.toFixed(1)}
            />
            <MetricsCard
              label="Porosity"
              value={(simulation.metrics.porosity * 100).toFixed(1) + '%'}
            />
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 3D Viewer */}
            <div className="lg:col-span-1">
              <h2 className="text-lg font-semibold mb-4">3D Visualization</h2>
              <AgglomerateViewer
                coordinates={coordinates}
                radii={radii}
              />
            </div>

            {/* Charts */}
            <div className="lg:col-span-1">
              <Tabs defaultValue="rg">
                <TabsList>
                  <TabsTrigger value="rg">Rg vs N</TabsTrigger>
                  <TabsTrigger value="rdf">RDF</TabsTrigger>
                  <TabsTrigger value="coord">Coordination</TabsTrigger>
                </TabsList>

                <TabsContent value="rg">
                  <LogLogPlot
                    xData={simulation.metrics.rg_evolution.n.map(Math.log)}
                    yData={simulation.metrics.rg_evolution.rg.map(Math.log)}
                    xLabel="log(N)"
                    yLabel="log(Rg)"
                    title="Radius of Gyration Evolution"
                    fitLine={{
                      slope: 1 / simulation.metrics.fractal_dimension,
                      intercept: Math.log(simulation.metrics.prefactor) / simulation.metrics.fractal_dimension
                    }}
                  />
                </TabsContent>

                <TabsContent value="rdf">
                  <RDFChart
                    r={simulation.metrics.rdf.r}
                    g_r={simulation.metrics.rdf.g_r}
                  />
                </TabsContent>

                <TabsContent value="coord">
                  <HistogramChart
                    data={simulation.metrics.coordination.histogram}
                    xLabel="Coordination Number"
                    yLabel="Count"
                    title={`Mean: ${simulation.metrics.coordination.mean.toFixed(2)}`}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </>
      )}

      {simulation.status === 'running' && (
        <div className="text-center py-20">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-slate-400">Simulation in progress...</p>
        </div>
      )}

      {simulation.status === 'failed' && (
        <div className="bg-red-900/20 border border-red-500 rounded-lg p-6">
          <h3 className="text-red-500 font-semibold">Simulation Failed</h3>
          <p className="text-slate-300 mt-2">{simulation.error_message}</p>
        </div>
      )}
    </div>
  )
}
```
