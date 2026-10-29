import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { NeighborGraphData } from '@/lib/types'

// Mock vis-network before importing components
import { MockNetwork, resetMock, getCurrentMock } from './__mocks__/visNetworkMock'

vi.mock('vis-network/standalone', () => ({
  Network: MockNetwork,
}))

import { NeighborGraph } from '../NeighborGraph'

function makeData(n: number, connected = true): NeighborGraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    x: i * 1.0,
    y: i * 2.0,
    z: i * 3.0,
    radius: 0.5,
    coordination: i % 6,
    distance_from_cdg: i * 0.1,
  }))
  const edges = n > 1
    ? [{ source: 1, target: 2 }, { source: 2, target: 3 }].slice(0, Math.min(2, n - 1))
    : []
  return {
    nodes,
    edges,
    stats: {
      n_particles: n,
      n_edges: edges.length,
      avg_coordination: 3.5,
      max_coordination: 5,
      min_coordination: 0,
      is_connected: connected,
    },
  }
}

const data50 = makeData(50)

describe('<NeighborGraph /> — Container', () => {
  beforeEach(() => {
    resetMock()
  })

  it('renders StatsBanner + NetworkCanvas when data is present', async () => {
    await act(async () => {
      render(<NeighborGraph data={data50} isLoading={false} />)
    })
    // StatsBanner renders particle count
    expect(screen.getByText('50')).toBeTruthy()
    expect(screen.getByText('Particles')).toBeTruthy()
    // NetworkCanvas container is present
    expect(screen.getByTestId('network-canvas')).toBeTruthy()
  })

  it('preserves props interface — same NeighborGraphProps shape', async () => {
    const onExport = vi.fn()
    await act(async () => {
      render(
        <NeighborGraph data={data50} isLoading={false} onExportAdjacency={onExport} />,
      )
    })
    // Export button renders
    const exportBtn = screen.getByRole('button', { name: /Export Adjacency/i })
    expect(exportBtn).toBeTruthy()
    fireEvent.click(exportBtn)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('renders LoadingSpinner when isLoading=true', () => {
    render(<NeighborGraph data={null} isLoading={true} />)
    expect(screen.getByText('Topology Analysis')).toBeTruthy()
    // No stats rendered
    expect(screen.queryByText('Particles')).toBeNull()
  })

  it('renders "No topology data" when data is null and not loading', () => {
    render(<NeighborGraph data={null} isLoading={false} />)
    expect(screen.getByText(/No topology data/i)).toBeTruthy()
  })

  it('clicking a node in NetworkCanvas shows NodeDetailPanel', async () => {
    await act(async () => {
      render(<NeighborGraph data={data50} isLoading={false} />)
    })

    const mock = getCurrentMock()!
    // Simulate click on node 1
    await act(async () => {
      mock.fireEvent('click', { nodes: [1], edges: [] })
    })

    // NodeDetailPanel should now render with Particle #1 Details
    expect(screen.getByText(/Particle #1 Details/i)).toBeTruthy()
  })

  it('clicking neighbor button in NodeDetailPanel updates selected node', async () => {
    await act(async () => {
      render(<NeighborGraph data={data50} isLoading={false} />)
    })

    const mock = getCurrentMock()!
    // Click node 1 first
    await act(async () => {
      mock.fireEvent('click', { nodes: [1], edges: [] })
    })

    // Node 1 has edge to node 2 — click neighbor button
    const neighborBtn = screen.getByRole('button', { name: '#2' })
    await act(async () => {
      fireEvent.click(neighborBtn)
    })

    // Detail panel should now show Particle #2
    expect(screen.getByText(/Particle #2 Details/i)).toBeTruthy()
  })

  it('shows large-graph warning when n_particles > 1000', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const largeData = makeData(1001)

    await act(async () => {
      render(<NeighborGraph data={largeData} isLoading={false} />)
    })

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('1001'),
    )
    alertSpy.mockRestore()
  })
})
