'use client'

/**
 * Grid mode for the Compare page (T10, change: visualize-multiple).
 *
 * Renders N independent `<AgglomerateViewer>` instances in a responsive
 * CSS grid. Each cell:
 *
 *   - Gets its own scaled coordinates/radii via `getScaleFactorNm(params)`
 *     so aggregates with different primary particle sizes all display in
 *     real-world nm units (R-3).
 *   - Gets the session-scoped camera key from `useCompareCamera()` so
 *     when sync is on, all cells share one camera scope (orbit controls
 *     move together); when off, each cell owns its own sub-scope.
 *   - Gets a `colorOverride` from the deterministic palette so the border
 *     tint, legend chip, and (in overlay mode) particle color all agree.
 *   - Shows a label overlay in the corner: color chip + sim name.
 *
 * Simulations whose `geometry` prop is null (fetch failed, or sim not
 * completed) render a plain "No geometry data" placeholder inside the
 * cell — the sim is counted as "loaded" at the page level, but the cell
 * shows the degraded state in-place so the user still sees its presence.
 */
import type { ReactNode } from 'react'

import { AgglomerateViewer } from '@/components/viewer3d/AgglomerateViewer'
import {
  getCompareGridLayout,
  type CompareGridLayout,
} from '@/lib/compare-utils'
import { getScaleFactorNm } from '@/lib/units'
import { cn } from '@/lib/utils'

import { useCompareCamera } from './CompareCameraProvider'

/**
 * Minimal shape each Compare sim must satisfy. We deliberately don't
 * depend on the richer `Simulation` type here to keep the component
 * reusable (the page owns the mapping).
 */
export interface CompareSim {
  id: string
  name: string
  /** Raw `simulation.parameters` — passed to `getScaleFactorNm`. */
  parameters: Record<string, unknown>
  /** Null when the sim isn't completed or geometry fetch failed. */
  geometry: {
    coordinates: number[][]
    radii: number[]
  } | null
}

interface CompareGridProps {
  simulations: CompareSim[]
  /** id → palette color map (from `getCompareColorPalette`). */
  colorMap: Record<string, string>
}

/**
 * Build the inline CSS for the grid container. Using inline style here
 * (rather than Tailwind utility classes) because `grid-cols-N` needs to
 * be dynamic across N ∈ [2..9] and Tailwind's JIT can't handle arbitrary
 * template-column counts without safelisting.
 *
 * The layout has no breakpoints, and this is the number that costs. At a 320px
 * viewport the shell's `<main>` spends `px-10` (80px), leaving 240px; the kit
 * `Panel` this grid sits in spends `p-[21px]` and a 1px border, leaving 196px.
 * With `gap-3` (12px) that is ~92px per cell for two simulations and ~57px for
 * three — thumbnails, not views:
 *
 *   - The corner label chip (border + `px-2` + the 8px colour dot + `gap-2`)
 *     spends ~26px of that, so the name is truncated to `max-w-[150px]`→ the
 *     remaining ~67px at two sims and ~32px at three, i.e. two or three
 *     characters plus an ellipsis.
 *   - `aspect-square` means the cell is as tall as it is wide (92px or 57px),
 *     and `overflow-hidden` clips the rest: the "No geometry data" line is
 *     `text-sm` (14px/20px) and needs three lines to wrap at 57px, so the
 *     bottom of that message is cut off where it matters most — the cell whose
 *     geometry is missing.
 *   - With nine simulations the layout is 3×3, so each cell is the 57px case
 *     with nine of them on one page.
 *
 * Documented rather than fixed on purpose: the issue asks for this degradation
 * to be written down, and a compare grid on a phone is a different product,
 * not a smaller one. Any fix (one column under `sm`, a horizontal scroller, a
 * list fallback) is a design decision with its own slice.
 */
function gridTemplateStyle(layout: CompareGridLayout): React.CSSProperties {
  return {
    gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
  }
}

export function CompareGrid({
  simulations,
  colorMap,
}: CompareGridProps): ReactNode {
  const { scopeFor } = useCompareCamera()
  const layout = getCompareGridLayout(simulations.length)

  return (
    <div
      data-testid="compare-grid"
      className="grid gap-3"
      style={gridTemplateStyle(layout)}
    >
      {simulations.map((sim) => {
        // The simulation's identity, from the one map the table, the overlay and
        // the chart also read: an index in the theme's ramp, so this cell's
        // border follows the theme with everything else. No substitute colour
        // here — a grey invented on this surface would be half an identity.
        const color = colorMap[sim.id]
        const scale = getScaleFactorNm(sim.parameters)

        // Apply per-sim nm scaling at this boundary. Each viewer then
        // runs its own center-of-mass centering internally (see
        // AgglomerateViewer's useMemo) so the scaled cloud fits its cell.
        const scaledCoords: number[][] = sim.geometry
          ? sim.geometry.coordinates.map(([x, y, z]) => [
              x * scale,
              y * scale,
              z * scale,
            ])
          : []
        const scaledRadii: number[] = sim.geometry
          ? sim.geometry.radii.map((r) => r * scale)
          : []

        return (
          <div
            key={sim.id}
            data-testid="compare-grid-cell"
            data-sim-id={sim.id}
            data-color={color}
            className={cn(
              'relative aspect-square overflow-hidden rounded-lg border-2 bg-surface',
            )}
            // The palette colour is per-simulation data, not a surface: it is
            // what tells one cell from another, and it is inline because it
            // varies per cell. Everything around it comes from the kit.
            style={{ borderColor: color }}
          >
            {/* Corner label: color chip + sim name. */}
            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink backdrop-blur-sm">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="max-w-[150px] truncate font-medium">
                {sim.name}
              </span>
            </div>

            {sim.geometry ? (
              <AgglomerateViewer
                coordinates={scaledCoords}
                radii={scaledRadii}
                colorOverride={color}
                cameraSource={{ scope: scopeFor(sim.id) }}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-ink-muted">
                No geometry data
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
