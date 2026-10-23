'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { buildVisNetworkData } from '@/lib/graphUtils'
import type { GraphTheme } from '@/lib/graphUtils'
import type { NeighborGraphData } from '@/lib/types'

/**
 * Detect the theme the application is actually in.
 *
 * `contacts-graph-viz` requires the graph canvas to match "the app's current
 * theme". Reading `prefers-color-scheme` satisfied that by accident while the
 * app had no theme of its own; now that an explicit choice can override the
 * operating system, the attribute is the answer and the media query is only a
 * fallback for the moment before the bootstrap script runs.
 *
 * SSR-safe and jsdom-safe: defaults to 'light'.
 */
function detectTheme(): GraphTheme {
  if (typeof document !== 'undefined') {
    const attribute = document.documentElement.dataset.theme
    if (attribute === 'dark' || attribute === 'light') return attribute
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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
  const [theme, setTheme] = useState<GraphTheme>(detectTheme)

  // Stable callback for click handler
  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick

  // Follow the application's theme, and the system preference only as the
  // fallback the detector uses before the attribute exists.
  useEffect(() => {
    if (typeof document === 'undefined') return

    const observer =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => setTheme(detectTheme()))
        : null
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    let mql: MediaQueryList | null = null
    const handler = () => setTheme(detectTheme())
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', handler)
    }

    return () => {
      observer?.disconnect()
      mql?.removeEventListener('change', handler)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false

    async function init() {
      const { Network } = await import('vis-network/standalone')
      if (destroyed || !containerRef.current) return

      const { nodes, edges, options } = buildVisNetworkData(data, theme)

      // Cast to `any`: our internal Vis* types are a subset of vis-network's
      // full types (we omit fields we never set, like `smooth.type`/`roundness`).
      // vis-network applies its own defaults for the omitted fields at runtime.
      const network = new Network(
        containerRef.current,
        { nodes, edges } as any,
        options as any,
      )
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
  }, [data, theme])

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
