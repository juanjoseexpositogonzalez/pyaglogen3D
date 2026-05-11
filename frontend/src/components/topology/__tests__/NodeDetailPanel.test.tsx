import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NodeDetailPanel from '../NodeDetailPanel'
import type { NeighborGraphNode, NeighborGraphEdge } from '@/lib/types'

const node1: NeighborGraphNode = {
  id: 1,
  x: 1.234,
  y: 5.678,
  z: 9.012,
  radius: 0.543,
  coordination: 3,
  distance_from_cdg: 2.456,
}

const node2: NeighborGraphNode = {
  id: 2,
  x: 10.0,
  y: 20.0,
  z: 30.0,
  radius: 0.7,
  coordination: 1,
  distance_from_cdg: 5.0,
}

const node3: NeighborGraphNode = {
  id: 3,
  x: 0,
  y: 0,
  z: 0,
  radius: 0.5,
  coordination: 0,
  distance_from_cdg: 0,
}

const edges: NeighborGraphEdge[] = [
  { source: 1, target: 2 },
  { source: 1, target: 3 },
]

describe('<NodeDetailPanel />', () => {
  it('returns null when selectedNode is null', () => {
    const { container } = render(
      <NodeDetailPanel
        selectedNode={null}
        allNodes={[node1, node2]}
        edges={edges}
        onSelectNeighbor={vi.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders position, radius, coordination, distance_from_cdg for a selected node', () => {
    render(
      <NodeDetailPanel
        selectedNode={node1}
        allNodes={[node1, node2, node3]}
        edges={edges}
        onSelectNeighbor={vi.fn()}
      />,
    )
    expect(screen.getByText(/1\.23/)).toBeTruthy() // x
    expect(screen.getByText(/5\.68/)).toBeTruthy() // y
    expect(screen.getByText(/9\.01/)).toBeTruthy() // z
    expect(screen.getByText('0.543')).toBeTruthy() // radius
    expect(screen.getByText('3')).toBeTruthy() // coordination
    expect(screen.getByText('2.46')).toBeTruthy() // distance_from_cdg
  })

  it('lists neighbors as clickable buttons with #<neighborId> labels', () => {
    render(
      <NodeDetailPanel
        selectedNode={node1}
        allNodes={[node1, node2, node3]}
        edges={edges}
        onSelectNeighbor={vi.fn()}
      />,
    )
    const btn2 = screen.getByRole('button', { name: '#2' })
    const btn3 = screen.getByRole('button', { name: '#3' })
    expect(btn2).toBeTruthy()
    expect(btn3).toBeTruthy()
  })

  it('calls onSelectNeighbor with neighbor id when neighbor button clicked', () => {
    const onSelect = vi.fn()
    render(
      <NodeDetailPanel
        selectedNode={node1}
        allNodes={[node1, node2, node3]}
        edges={edges}
        onSelectNeighbor={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '#2' }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('does not render Neighbors section when node has 0 neighbors', () => {
    const isolated: NeighborGraphNode = {
      id: 99,
      x: 0,
      y: 0,
      z: 0,
      radius: 0.5,
      coordination: 0,
      distance_from_cdg: 0,
    }
    render(
      <NodeDetailPanel
        selectedNode={isolated}
        allNodes={[isolated, node1]}
        edges={edges}
        onSelectNeighbor={vi.fn()}
      />,
    )
    expect(screen.queryByText('Neighbors:')).toBeNull()
  })
})
