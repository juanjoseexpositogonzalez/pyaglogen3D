/**
 * Pure utility functions for transforming NeighborGraphData
 * into vis-network–compatible data structures.
 */
import type { NeighborGraphData } from '@/lib/types'

/** Spec R5 palette: 0→gray, 1→rose, 2→orange, 3→amber, 4→yellow, 5→lime, 6→emerald, 7+→blue */
const COORDINATION_PALETTE = [
  '#9ca3af', // 0 — gray-400
  '#ef4444', // 1 — rose-400
  '#f97316', // 2 — orange-400
  '#f59e0b', // 3 — amber-400
  '#eab308', // 4 — yellow-400
  '#84cc16', // 5 — lime-400
  '#22c55e', // 6 — emerald-400
  '#3b82f6', // 7+ — blue-400
] as const

/**
 * Returns the hex color for a given coordination number.
 * Clamps to the last entry (blue) for coord ≥ 7.
 */
export function coordinationColor(coord: number): string {
  const idx = Math.min(coord, COORDINATION_PALETTE.length - 1)
  return COORDINATION_PALETTE[idx]
}

/**
 * Returns node size (px) linearly interpolated between 12 and 32
 * based on coordination / maxCoord. Returns 12 when maxCoord is 0.
 */
export function coordinationSize(coord: number, maxCoord: number): number {
  if (maxCoord === 0) return 12
  return 12 + (20 * coord) / maxCoord
}

// -- Vis-network data types (internal) --

interface VisNode {
  id: number
  label: string
  color: string
  size: number
  title: string
  x?: number
  y?: number
}

interface VisEdge {
  from: number
  to: number
  color: string
  smooth: { enabled: boolean }
}

interface VisOptions {
  physics: {
    solver: string
    barnesHut: {
      gravitationalConstant: number
      centralGravity: number
      springLength: number
      springConstant: number
      damping: number
      avoidOverlap: number
    }
    stabilization: {
      iterations: number
    }
  }
  interaction: {
    hover: boolean
    tooltipDelay: number
  }
  edges: {
    width: number
  }
}

export interface BuildVisNetworkResult {
  nodes: VisNode[]
  edges: VisEdge[]
  options: VisOptions
}

/**
 * Transforms NeighborGraphData into vis-network–compatible nodes, edges, and options.
 * Pure function — no DOM access.
 */
export function buildVisNetworkData(data: NeighborGraphData): BuildVisNetworkResult {
  const maxCoord = data.nodes.reduce((max, n) => Math.max(max, n.coordination), 0)
  const edgeColor = '#cbd5e1' // light mode default

  const nodes: VisNode[] = []
  for (let i = 0; i < data.nodes.length; i++) {
    const n = data.nodes[i]
    nodes.push({
      id: n.id,
      label: `#${n.id}`,
      color: coordinationColor(n.coordination),
      size: coordinationSize(n.coordination, maxCoord),
      title: `Particle #${n.id}\nCoordination: ${n.coordination}\nPos: (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`,
    })
  }

  const edges: VisEdge[] = []
  for (let i = 0; i < data.edges.length; i++) {
    const e = data.edges[i]
    edges.push({
      from: e.source,
      to: e.target,
      color: edgeColor,
      smooth: { enabled: true },
    })
  }

  const options: VisOptions = {
    physics: {
      solver: 'barnesHut',
      barnesHut: {
        gravitationalConstant: -3000,
        centralGravity: 0.1,
        springLength: 60,
        springConstant: 0.08,
        damping: 0.12,
        avoidOverlap: 0.5,
      },
      stabilization: {
        iterations: 1000,
      },
    },
    interaction: {
      hover: true,
      tooltipDelay: 200,
    },
    edges: {
      width: 1,
    },
  }

  return { nodes, edges, options }
}
