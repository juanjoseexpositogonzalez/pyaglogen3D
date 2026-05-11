import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import type { NeighborGraphData } from '@/lib/types'

// Setup mock BEFORE importing NetworkCanvas
import { MockNetwork, resetMock, getCurrentMock } from './__mocks__/visNetworkMock'

vi.mock('vis-network/standalone', () => ({
  Network: MockNetwork,
}))

// Import after mock is set up
import NetworkCanvas from '../NetworkCanvas'

// -- Test data --
function makeData(n: number): NeighborGraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    x: i,
    y: i,
    z: i,
    radius: 0.5,
    coordination: i % 4,
    distance_from_cdg: i * 0.1,
  }))
  return {
    nodes,
    edges: n > 1 ? [{ source: 1, target: 2 }] : [],
    stats: {
      n_particles: n,
      n_edges: n > 1 ? 1 : 0,
      avg_coordination: 2,
      max_coordination: 3,
      min_coordination: 0,
      is_connected: true,
    },
  }
}

const data5 = makeData(5)
const data3 = makeData(3)

describe('<NetworkCanvas />', () => {
  beforeEach(() => {
    resetMock()
    MockNetwork.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('mounts and calls Network constructor with container, nodes, edges, and options', async () => {
    await act(async () => {
      render(
        <NetworkCanvas
          data={data5}
          onNodeClick={vi.fn()}
          selectedNodeId={null}
        />,
      )
    })

    expect(MockNetwork).toHaveBeenCalledTimes(1)
    const args = MockNetwork.mock.calls[0]
    // First arg is the container DOM element
    expect(args[0]).toBeInstanceOf(HTMLElement)
    // Second arg is { nodes, edges } data
    expect(args[1].nodes).toBeDefined()
    expect(args[1].edges).toBeDefined()
    // Third arg is options with physics
    expect(args[2].physics.solver).toBe('barnesHut')
  })

  it('registers a click handler via network.on("click", ...)', async () => {
    await act(async () => {
      render(
        <NetworkCanvas
          data={data5}
          onNodeClick={vi.fn()}
          selectedNodeId={null}
        />,
      )
    })

    const mock = getCurrentMock()
    expect(mock).not.toBeNull()
    expect(mock!.instance.on).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('click on a node calls onNodeClick with the node id', async () => {
    const onNodeClick = vi.fn()
    await act(async () => {
      render(
        <NetworkCanvas
          data={data5}
          onNodeClick={onNodeClick}
          selectedNodeId={null}
        />,
      )
    })

    const mock = getCurrentMock()!
    // Simulate clicking node 1
    mock.fireEvent('click', { nodes: [1], edges: [] })
    expect(onNodeClick).toHaveBeenCalledWith(1)
  })

  it('click on empty space calls onNodeClick(null)', async () => {
    const onNodeClick = vi.fn()
    await act(async () => {
      render(
        <NetworkCanvas
          data={data5}
          onNodeClick={onNodeClick}
          selectedNodeId={null}
        />,
      )
    })

    const mock = getCurrentMock()!
    mock.fireEvent('click', { nodes: [], edges: [] })
    expect(onNodeClick).toHaveBeenCalledWith(null)
  })

  it('calls destroy() on unmount', async () => {
    let unmount: () => void
    await act(async () => {
      const result = render(
        <NetworkCanvas
          data={data5}
          onNodeClick={vi.fn()}
          selectedNodeId={null}
        />,
      )
      unmount = result.unmount
    })

    const mock = getCurrentMock()!
    unmount!()
    expect(mock.instance.destroy).toHaveBeenCalled()
  })

  it('calls focus() when selectedNodeId changes to a value', async () => {
    const { rerender } = await act(async () => {
      return render(
        <NetworkCanvas
          data={data5}
          onNodeClick={vi.fn()}
          selectedNodeId={null}
        />,
      )
    })

    const mock = getCurrentMock()!

    await act(async () => {
      rerender(
        <NetworkCanvas
          data={data5}
          onNodeClick={vi.fn()}
          selectedNodeId={3}
        />,
      )
    })

    expect(mock.instance.focus).toHaveBeenCalledWith(3, expect.any(Object))
  })

  it('shows stabilization spinner initially and hides after stabilizationIterationsDone', async () => {
    // The mock fires stabilizationIterationsDone immediately via once(),
    // so stabilization completes synchronously during mount
    await act(async () => {
      render(
        <NetworkCanvas
          data={data5}
          onNodeClick={vi.fn()}
          selectedNodeId={null}
        />,
      )
    })

    // After stabilization fires, spinner should be gone
    expect(screen.queryByText('Stabilizing…')).toBeNull()
  })

  it('handles empty nodes array without crash', async () => {
    const emptyData = makeData(0)
    await act(async () => {
      render(
        <NetworkCanvas
          data={emptyData}
          onNodeClick={vi.fn()}
          selectedNodeId={null}
        />,
      )
    })

    expect(MockNetwork).toHaveBeenCalledTimes(1)
  })
})
