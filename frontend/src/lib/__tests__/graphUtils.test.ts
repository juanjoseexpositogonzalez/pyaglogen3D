import { describe, it, expect } from 'vitest'
import { coordinationColor, coordinationSize, buildVisNetworkData } from '../graphUtils'
import type { NeighborGraphData } from '@/lib/types'

/**
 * Spec R5 palette:
 * 0→gray(#9ca3af), 1→rose(#ef4444), 2→orange(#f97316), 3→amber(#f59e0b),
 * 4→yellow(#eab308), 5→lime(#84cc16), 6→emerald(#22c55e), 7+→blue(#3b82f6)
 */
describe('coordinationColor', () => {
  it('returns gray (#9ca3af) for coordination 0', () => {
    expect(coordinationColor(0)).toBe('#9ca3af')
  })

  it('returns red (#ef4444) for coordination 1', () => {
    expect(coordinationColor(1)).toBe('#ef4444')
  })

  it('returns blue (#3b82f6) for coordination 7', () => {
    expect(coordinationColor(7)).toBe('#3b82f6')
  })

  it('clamps to blue (#3b82f6) for coordination > 7', () => {
    expect(coordinationColor(10)).toBe('#3b82f6')
    expect(coordinationColor(99)).toBe('#3b82f6')
  })
})

describe('coordinationSize', () => {
  it('returns 12 for coord=0', () => {
    expect(coordinationSize(0, 6)).toBe(12)
  })

  it('returns 32 for coord=maxCoord', () => {
    expect(coordinationSize(6, 6)).toBe(32)
  })

  it('returns linear interpolation for intermediate values', () => {
    // coord=3, maxCoord=6 → 12 + (20 * 3/6) = 22
    expect(coordinationSize(3, 6)).toBe(22)
  })

  it('returns 12 when maxCoord=0 (division by zero guard)', () => {
    expect(coordinationSize(0, 0)).toBe(12)
    expect(coordinationSize(5, 0)).toBe(12)
  })
})

// -- Helper: generate a small NeighborGraphData for tests --
function makeGraphData(nodeCount: number, edgeCount: number): NeighborGraphData {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: i + 1,
    x: i * 1.0,
    y: i * 2.0,
    z: i * 3.0,
    radius: 0.5,
    coordination: i % 8,
    distance_from_cdg: i * 0.1,
  }))
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    source: (i % nodeCount) + 1,
    target: ((i + 1) % nodeCount) + 1,
  }))
  return {
    nodes,
    edges,
    stats: {
      n_particles: nodeCount,
      n_edges: edgeCount,
      avg_coordination: 3.5,
      max_coordination: 7,
      min_coordination: 0,
      is_connected: true,
    },
  }
}

describe('buildVisNetworkData', () => {
  const data10 = makeGraphData(10, 9)

  it('returns correct number of nodes and edges', () => {
    const result = buildVisNetworkData(data10)
    expect(result.nodes).toHaveLength(10)
    expect(result.edges).toHaveLength(9)
  })

  it('maps node id, label, color, and size correctly', () => {
    const result = buildVisNetworkData(data10)
    const first = result.nodes[0]
    expect(first.id).toBe(1)
    expect(first.label).toBe('#1')
    expect(first.color).toBe(coordinationColor(0)) // coord=0 → gray
    expect(first.size).toBe(12) // coord=0 → min size
  })

  it('maps edges with from, to, color, and smooth', () => {
    const result = buildVisNetworkData(data10)
    const firstEdge = result.edges[0]
    expect(firstEdge.from).toBe(1)
    expect(firstEdge.to).toBe(2)
    expect(firstEdge.color).toBe('#cbd5e1')
    expect(firstEdge.smooth.enabled).toBe(true)
  })

  it('uses Barnes-Hut physics options from spec', () => {
    const result = buildVisNetworkData(data10)
    const bh = result.options.physics.barnesHut
    expect(bh.gravitationalConstant).toBe(-3000)
    expect(bh.centralGravity).toBe(0.1)
    expect(bh.springLength).toBe(60)
    expect(bh.springConstant).toBe(0.08)
    expect(bh.damping).toBe(0.12)
    expect(bh.avoidOverlap).toBe(0.5)
  })

  it('sets node tooltip with particle info', () => {
    const result = buildVisNetworkData(data10)
    const node3 = result.nodes[2] // id=3, coord=2
    expect(node3.title).toContain('Particle #3')
    expect(node3.title).toContain('Coordination: 2')
  })

  it('handles N=1 graph — single node, no edges', () => {
    const data1 = makeGraphData(1, 0)
    const result = buildVisNetworkData(data1)
    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
    expect(result.nodes[0].id).toBe(1)
  })

  it('handles graph with zero edges gracefully', () => {
    const noEdges = makeGraphData(5, 0)
    const result = buildVisNetworkData(noEdges)
    expect(result.nodes).toHaveLength(5)
    expect(result.edges).toHaveLength(0)
  })

  it('handles N=1000 without stack overflow (uses for loops)', () => {
    const large = makeGraphData(1000, 999)
    const result = buildVisNetworkData(large)
    expect(result.nodes).toHaveLength(1000)
    expect(result.edges).toHaveLength(999)
  })

  // Performance threshold: 200ms for N=1000. Skip if host is slow (CI/low-resource).
  it('N=1000 completes in <200ms', () => {
    const large = makeGraphData(1000, 999)
    const start = performance.now()
    buildVisNetworkData(large)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})
