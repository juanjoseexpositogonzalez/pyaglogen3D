import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatsBanner from '../StatsBanner'
import type { NeighborGraphStats } from '@/lib/types'

const connectedStats: NeighborGraphStats = {
  n_particles: 350,
  n_edges: 1200,
  avg_coordination: 6.86,
  max_coordination: 12,
  min_coordination: 1,
  is_connected: true,
}

const disconnectedStats: NeighborGraphStats = {
  n_particles: 50,
  n_edges: 40,
  avg_coordination: 1.60,
  max_coordination: 3,
  min_coordination: 0,
  is_connected: false,
}

describe('<StatsBanner />', () => {
  it('renders 4 stat cards: Particles, Connections, Avg. Coordination, Graph Status', () => {
    render(<StatsBanner stats={connectedStats} />)
    expect(screen.getByText('350')).toBeTruthy()
    expect(screen.getByText('1200')).toBeTruthy()
    expect(screen.getByText('6.86')).toBeTruthy()
    expect(screen.getByText('Particles')).toBeTruthy()
    expect(screen.getByText('Connections')).toBeTruthy()
    expect(screen.getByText('Avg. Coordination')).toBeTruthy()
    expect(screen.getByText('Graph Status')).toBeTruthy()
  })

  it('renders Connected badge for connected graph', () => {
    render(<StatsBanner stats={connectedStats} />)
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('renders Disconnected badge for disconnected graph', () => {
    render(<StatsBanner stats={disconnectedStats} />)
    expect(screen.getByText('Disconnected')).toBeTruthy()
  })
})
