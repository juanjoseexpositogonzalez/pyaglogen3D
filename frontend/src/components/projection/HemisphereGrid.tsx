'use client'

import { stereographicProject, directionsMatch } from '@/lib/stereographic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface HemisphereGridProps {
  gridDirections: Array<{ az: number; el: number }>
  generatedDirections: Array<{ az: number; el: number; projectionId: string }>
  selectedDirection?: { az: number; el: number }
  onDirectionClick?: (direction: { az: number; el: number; projectionId: string }) => void
  size?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_SIZE = 300
const MATCH_TOLERANCE = 0.5 // degrees
const PARALLEL_ELEVATIONS = [15, 30, 45, 60, 75]
const MERIDIAN_AZIMUTHS = Array.from({ length: 12 }, (_, i) => i * 30)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function HemisphereGrid({
  gridDirections,
  generatedDirections,
  selectedDirection,
  onDirectionClick,
  size = DEFAULT_SIZE,
}: HemisphereGridProps) {
  // Dev performance warning
  if (process.env.NODE_ENV !== 'production' && gridDirections.length > 500) {
    console.warn(
      `HemisphereGrid: ${gridDirections.length} grid directions exceeds 500. ` +
      `Consider reducing resolution for better SVG performance.`
    )
  }

  const center = size / 2
  const generatedCount = generatedDirections.length
  const totalCount = gridDirections.length

  // Check if a grid direction has been generated
  function findGenerated(dir: { az: number; el: number }) {
    return generatedDirections.find((g) =>
      directionsMatch(g, dir, MATCH_TOLERANCE)
    )
  }

  // Check if a direction is selected
  function isSelected(dir: { az: number; el: number }) {
    if (!selectedDirection) return false
    return directionsMatch(dir, selectedDirection, MATCH_TOLERANCE)
  }

  return (
    <svg
      role="img"
      aria-label={`Projection direction coverage: ${generatedCount} of ${totalCount} directions rendered`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto"
    >
      {/* Outer boundary (equator) */}
      <circle
        data-grid="boundary"
        cx={center}
        cy={center}
        r={center - 1}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="text-gray-300"
      />

      {/* Parallels at 15°, 30°, 45°, 60°, 75° */}
      {PARALLEL_ELEVATIONS.map((el) => {
        const r = center * Math.cos((el * Math.PI) / 180) / (1 + Math.sin((el * Math.PI) / 180))
        return (
          <circle
            key={`parallel-${el}`}
            data-grid="parallel"
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
            strokeDasharray="2,2"
            className="text-gray-200"
          />
        )
      })}

      {/* Meridians every 30° */}
      {MERIDIAN_AZIMUTHS.map((az) => {
        const azRad = (az * Math.PI) / 180
        const edgeR = center - 1
        return (
          <line
            key={`meridian-${az}`}
            data-grid="meridian"
            x1={center}
            y1={center}
            x2={center + edgeR * Math.cos(azRad)}
            y2={center - edgeR * Math.sin(azRad)}
            stroke="currentColor"
            strokeWidth={0.5}
            strokeDasharray="2,2"
            className="text-gray-200"
          />
        )
      })}

      {/* Pole marker */}
      <circle
        data-grid="pole"
        cx={center}
        cy={center}
        r={2}
        fill="currentColor"
        className="text-gray-400"
      />

      {/* Direction dots */}
      {gridDirections.map((dir, i) => {
        const gen = findGenerated(dir)
        const selected = isSelected(dir)
        const { x, y } = stereographicProject(dir.az, dir.el, size)

        if (gen) {
          // Generated dot (or selected)
          const dotType = selected ? 'selected' : 'generated'
          return (
            <circle
              key={`dot-${i}`}
              data-dot={dotType}
              cx={x}
              cy={y}
              r={5}
              fill="currentColor"
              stroke={selected ? '#1d4ed8' : undefined}
              strokeWidth={selected ? 2 : undefined}
              className="text-blue-500 cursor-pointer"
              tabIndex={0}
              onClick={() => onDirectionClick?.(gen)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onDirectionClick?.(gen)
                }
              }}
            >
              <title>{`Az: ${dir.az}°, El: ${dir.el}°`}</title>
            </circle>
          )
        }

        // Grid-only dot
        return (
          <circle
            key={`dot-${i}`}
            data-dot="grid"
            cx={x}
            cy={y}
            r={3}
            fill="currentColor"
            className="text-gray-400"
          >
            <title>{`Az: ${dir.az}°, El: ${dir.el}°`}</title>
          </circle>
        )
      })}
    </svg>
  )
}
