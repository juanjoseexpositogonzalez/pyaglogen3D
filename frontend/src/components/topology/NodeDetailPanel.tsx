import { useMemo } from 'react'
import type { NeighborGraphNode, NeighborGraphEdge } from '@/lib/types'

interface NodeDetailPanelProps {
  selectedNode: NeighborGraphNode | null
  allNodes: NeighborGraphNode[]
  edges: NeighborGraphEdge[]
  onSelectNeighbor: (nodeId: number) => void
}

/**
 * Selected node detail panel with neighbor navigation buttons.
 * Extracted from NeighborGraph.tsx lines 155-205.
 */
export default function NodeDetailPanel({
  selectedNode,
  edges,
  onSelectNeighbor,
}: NodeDetailPanelProps) {
  const neighbors = useMemo(() => {
    if (!selectedNode) return []
    return edges
      .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
      .map((e) => (e.source === selectedNode.id ? e.target : e.source))
      .sort((a, b) => a - b)
  }, [selectedNode, edges])

  if (!selectedNode) return null

  return (
    <div className="p-4 border rounded-lg bg-muted/30">
      <h4 className="text-sm font-medium mb-2">
        Particle #{selectedNode.id} Details
      </h4>
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-muted-foreground">Position:</span>
            <span className="font-mono ml-1">
              ({selectedNode.x.toFixed(2)}, {selectedNode.y.toFixed(2)},{' '}
              {selectedNode.z.toFixed(2)})
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Radius:</span>
            <span className="font-mono ml-1">{selectedNode.radius.toFixed(3)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Coordination:</span>
            <span className="font-mono ml-1">{selectedNode.coordination}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Dist. from CDG:</span>
            <span className="font-mono ml-1">
              {selectedNode.distance_from_cdg.toFixed(2)}
            </span>
          </div>
        </div>
        {neighbors.length > 0 && (
          <div>
            <span className="text-muted-foreground">Neighbors:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {neighbors.map((neighborId) => (
                <button
                  key={neighborId}
                  onClick={() => onSelectNeighbor(neighborId)}
                  className="px-2 py-0.5 text-xs bg-primary/20 hover:bg-primary/30 rounded"
                >
                  #{neighborId}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
