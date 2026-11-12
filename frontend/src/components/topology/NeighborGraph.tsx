'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Network, Download } from 'lucide-react'
import type { NeighborGraphData, NeighborGraphNode } from '@/lib/types'
import StatsBanner from './StatsBanner'
import NetworkCanvas from './NetworkCanvas'
import NodeDetailPanel from './NodeDetailPanel'

interface NeighborGraphProps {
  data: NeighborGraphData | null
  isLoading: boolean
  onExportAdjacency?: () => void
}

/**
 * Container component for topology graph visualization.
 * Composes StatsBanner + NetworkCanvas + NodeDetailPanel.
 * Same export name and props interface as original.
 */
export function NeighborGraph({ data, isLoading, onExportAdjacency }: NeighborGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)

  // Large graph warning (spec R11).
  //
  // This was a `window.alert` inside a `useEffect`: it blocks the main thread, and
  // `data` changing identity on a refetch runs it again. A blocking modal is the
  // last thing a page needs while it is trying to unmount, so the same sentence is
  // now a notice in the page (#312).
  const [largeGraphWarning, setLargeGraphWarning] = useState<string | null>(null)
  useEffect(() => {
    if (data && data.stats.n_particles > 1000) {
      setLargeGraphWarning(
        `Large graph warning: ${data.stats.n_particles} particles. The force-directed layout may take longer to stabilize.`,
      )
      return
    }
    setLargeGraphWarning(null)
  }, [data])

  // Reset selection when data changes
  useEffect(() => {
    setSelectedNodeId(null)
  }, [data])

  const handleNodeClick = useCallback((nodeId: number | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleSelectNeighbor = useCallback((nodeId: number) => {
    setSelectedNodeId(nodeId)
  }, [])

  // Find the selected node object
  const selectedNode: NeighborGraphNode | null =
    data && selectedNodeId !== null
      ? data.nodes.find((n) => n.id === selectedNodeId) ?? null
      : null

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Topology Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <LoadingSpinner />
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Topology Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            No topology data available
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Topology Analysis
          </CardTitle>
          {onExportAdjacency && (
            <Button variant="outline" size="sm" onClick={onExportAdjacency}>
              <Download className="h-4 w-4 mr-1" />
              Export Adjacency
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {largeGraphWarning && (
          <p role="status" className="text-sm text-ink-muted">
            {largeGraphWarning}
          </p>
        )}
        <StatsBanner stats={data.stats} />

        <NetworkCanvas
          data={data}
          onNodeClick={handleNodeClick}
          selectedNodeId={selectedNodeId}
        />

        {selectedNode && (
          <NodeDetailPanel
            selectedNode={selectedNode}
            allNodes={data.nodes}
            edges={data.edges}
            onSelectNeighbor={handleSelectNeighbor}
          />
        )}
      </CardContent>
    </Card>
  )
}
