'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { buildVisNetworkData } from '@/lib/graphUtils'
import type { NeighborGraphData } from '@/lib/types'

interface NetworkCanvasProps {
  data: NeighborGraphData
  onNodeClick: (nodeId: number | null) => void
  selectedNodeId: number | null
}

/**
 * SSR-safe canvas wrapper for vis-network force-directed graph.
 * Uses dynamic import() inside useEffect per #612 pattern.
 */
export default function NetworkCanvas({
  data,
  onNodeClick,
  selectedNodeId,
}: NetworkCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<{ destroy: () => void; focus: (id: number, opts: object) => void; on: (event: string, cb: (...args: unknown[]) => void) => void; once: (event: string, cb: () => void) => void; setOptions: (opts: object) => void } | null>(null)
  const [stabilizing, setStabilizing] = useState(true)

  // Stable callback for click handler
  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick

  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false

    async function init() {
      const { Network } = await import('vis-network/standalone')
      if (destroyed || !containerRef.current) return

      const { nodes, edges, options } = buildVisNetworkData(data)

      const network = new Network(containerRef.current, { nodes, edges }, options)
      networkRef.current = network as typeof networkRef.current

      network.on('click', (params: { nodes: number[] }) => {
        if (params.nodes.length > 0) {
          onNodeClickRef.current(params.nodes[0])
        } else {
          onNodeClickRef.current(null)
        }
      })

      network.once('stabilizationIterationsDone', () => {
        if (!destroyed) {
          setStabilizing(false)
          network.setOptions({ physics: { enabled: false } })
        }
      })
    }

    init()

    return () => {
      destroyed = true
      if (networkRef.current) {
        networkRef.current.destroy()
        networkRef.current = null
      }
    }
  }, [data])

  // Focus on selected node when selectedNodeId changes
  useEffect(() => {
    if (selectedNodeId !== null && networkRef.current) {
      networkRef.current.focus(selectedNodeId, {
        scale: 1.2,
        animation: { duration: 300, easingFunction: 'easeInOutQuad' },
      })
    }
  }, [selectedNodeId])

  return (
    <div className="relative">
      {stabilizing && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 rounded-lg">
          <span className="text-sm text-muted-foreground animate-pulse">
            Stabilizing…
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-[400px] border rounded-lg"
        data-testid="network-canvas"
      />
    </div>
  )
}
