/**
 * Grid direction generators for projection modes.
 *
 * Produces arrays of {az, el} (degrees) for the upper hemisphere (El ∈ [0, 90]).
 */

import type { ProjectionMode } from '@/components/projection/ProjectionControls'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------
export interface GridConfig {
  az_step: number
  el_step: number
}

export interface FibonacciConfig {
  n: number
}

export type ProjectionGridConfig = GridConfig | FibonacciConfig

// ---------------------------------------------------------------------------
// Grid mode
// ---------------------------------------------------------------------------
function computeGrid(config: GridConfig): Array<{ az: number; el: number }> {
  const { az_step, el_step } = config
  if (az_step <= 0 || el_step <= 0) return []

  const dirs: Array<{ az: number; el: number }> = []

  for (let el = 0; el < 90; el += el_step) {
    for (let az = 0; az < 360; az += az_step) {
      dirs.push({ az, el })
    }
  }

  // Pole: single point at El=90 (avoid az duplication)
  if (90 % el_step === 0 || el_step <= 90) {
    dirs.push({ az: 0, el: 90 })
  }

  return dirs
}

// ---------------------------------------------------------------------------
// Fibonacci mode — golden angle lattice on upper hemisphere
// ---------------------------------------------------------------------------
function computeFibonacci(config: FibonacciConfig): Array<{ az: number; el: number }> {
  const { n } = config
  if (n <= 0) return []
  if (n === 1) return [{ az: 0, el: 90 }]

  const phi = Math.PI * (3 - Math.sqrt(5)) // golden angle in radians
  const dirs: Array<{ az: number; el: number }> = []

  for (let i = 0; i < n; i++) {
    // y goes from 1 (pole) to 0 (equator) for upper hemisphere
    const y = 1 - i / (n - 1)
    const radius = Math.sqrt(1 - y * y)
    const theta = phi * i

    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius

    let az = (Math.atan2(z, x) * 180) / Math.PI
    if (az < 0) az += 360

    const el = (Math.asin(y) * 180) / Math.PI

    dirs.push({ az, el })
  }

  return dirs
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute direction grid for the given projection mode and config.
 */
export function computeGridDirections(
  mode: ProjectionMode,
  config: ProjectionGridConfig,
): Array<{ az: number; el: number }> {
  switch (mode) {
    case 'grid':
    case 'legacy':
      return computeGrid(config as GridConfig)
    case 'fibonacci':
      return computeFibonacci(config as FibonacciConfig)
    default:
      return []
  }
}
