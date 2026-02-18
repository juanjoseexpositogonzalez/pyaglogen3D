'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Network, GitBranch, Download } from 'lucide-react'
import type { NeighborGraphData } from '@/lib/types'

interface NeighborGraphProps {
  data: NeighborGraphData | null
  isLoading: boolean
  onExportAdjacency?: () => void
}

export function NeighborGraph({ data, isLoading, onExportAdjacency }: NeighborGraphProps) {
  const [selectedNode, setSelectedNode] = useState<number | null>(null)

  // Group nodes by coordination number for distribution display
  const coordinationDistribution = useMemo(() => {
    if (!data) return []
    const dist: Record<number, number> = {}
    data.nodes.forEach((node) => {
      dist[node.coordination] = (dist[node.coordination] || 0) + 1
    })
    return Object.entries(dist)
      .map(([coord, count]) => ({ coordination: parseInt(coord), count }))
      .sort((a, b) => a.coordination - b.coordination)
  }, [data])

  // Get neighbors of selected node
  const selectedNodeNeighbors = useMemo(() => {
    if (!data || selectedNode === null) return []
    return data.edges
      .filter((e) => e.source === selectedNode || e.target === selectedNode)
      .map((e) => (e.source === selectedNode ? e.target : e.source))
      .sort((a, b) => a - b)
  }, [data, selectedNode])

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
        {/* Graph Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold">{data.stats.n_particles}</p>
            <p className="text-xs text-muted-foreground">Particles</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold">{data.stats.n_edges}</p>
            <p className="text-xs text-muted-foreground">Connections</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold">{data.stats.avg_coordination.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Avg. Coordination</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <Badge variant={data.stats.is_connected ? 'default' : 'destructive'}>
              {data.stats.is_connected ? 'Connected' : 'Disconnected'}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">Graph Status</p>
          </div>
        </div>

        {/* Coordination Distribution */}
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Coordination Distribution
          </h4>
          <div className="flex flex-wrap gap-2">
            {coordinationDistribution.map(({ coordination, count }) => (
              <div
                key={coordination}
                className="px-3 py-1 bg-primary/10 rounded-full text-sm"
              >
                <span className="font-medium">{coordination}</span>
                <span className="text-muted-foreground ml-1">({count})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Interactive Node Explorer */}
        <div>
          <h4 className="text-sm font-medium mb-2">Particle Explorer</h4>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-2 border rounded-lg bg-muted/30">
            {data.nodes.map((node) => (
              <button
                key={node.id}
                onClick={() => setSelectedNode(node.id === selectedNode ? null : node.id)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  node.id === selectedNode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted border'
                }`}
                title={`Particle ${node.id}: ${node.coordination} neighbors`}
              >
                {node.id}
              </button>
            ))}
          </div>
        </div>

        {/* Selected Node Details */}
        {selectedNode !== null && (
          <div className="p-4 border rounded-lg bg-muted/30">
            <h4 className="text-sm font-medium mb-2">
              Particle #{selectedNode} Details
            </h4>
            {(() => {
              const node = data.nodes.find((n) => n.id === selectedNode)
              if (!node) return null
              return (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground">Position:</span>
                      <span className="font-mono ml-1">
                        ({node.x.toFixed(2)}, {node.y.toFixed(2)}, {node.z.toFixed(2)})
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Radius:</span>
                      <span className="font-mono ml-1">{node.radius.toFixed(3)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Coordination:</span>
                      <span className="font-mono ml-1">{node.coordination}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Dist. from CDG:</span>
                      <span className="font-mono ml-1">{node.distance_from_cdg.toFixed(2)}</span>
                    </div>
                  </div>
                  {selectedNodeNeighbors.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Neighbors:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedNodeNeighbors.map((neighborId) => (
                          <button
                            key={neighborId}
                            onClick={() => setSelectedNode(neighborId)}
                            className="px-2 py-0.5 text-xs bg-primary/20 hover:bg-primary/30 rounded"
                          >
                            #{neighborId}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
