/**
 * Grid direction generators for projection modes.
 *
 * Produces arrays of {az, el} (degrees) for the upper hemisphere (El ∈ [0, 90]).
 */

import type { ProjectionMode, ModeChangeConfig } from '@/components/projection/ProjectionControls'

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
 * Convert raw control values (from ProjectionControls.onModeChange) to the
 * {@link ProjectionGridConfig} expected by {@link computeGridDirections}.
 *
 * Grid mode: n_az/n_el (counts) → az_step/el_step (degrees).
 * Fibonacci / legacy pass through unchanged.
 */
export function modeConfigToGridConfig(
  mode: ProjectionMode,
  config: ModeChangeConfig,
): ProjectionGridConfig {
  if (mode === 'grid' && 'n_az' in config) {
    return {
      az_step: 360 / config.n_az,
      el_step: 90 / (config.n_el - 1),
    }
  }
  return config as ProjectionGridConfig
}

/**
 * Derive generated directions (with synthetic projectionId) from an
 * {@link ExportProjectionsPayload}. Used after a successful export to
 * populate the hemisphere's generated-dot layer.
 */
export function deriveGeneratedDirections(
  payload: {
    mode?: string
    n_az?: number
    n_el?: number
    n?: number
    azimuth_step?: number
    elevation_step?: number
  },
): Array<{ az: number; el: number; projectionId: string }> {
  const mode = (payload.mode ?? '') as ProjectionMode
  let config: ProjectionGridConfig

  if (mode === 'grid' && payload.n_az && payload.n_el) {
    config = modeConfigToGridConfig('grid', {
      n_az: payload.n_az,
      n_el: payload.n_el,
    })
  } else if (mode === 'fibonacci' && payload.n) {
    config = { n: payload.n }
  } else if (mode === 'legacy' && payload.azimuth_step && payload.elevation_step) {
    config = { az_step: payload.azimuth_step, el_step: payload.elevation_step }
  } else {
    return []
  }

  const dirs = computeGridDirections(mode, config)
  return dirs.map((d) => ({
    ...d,
    projectionId: `az${Math.round(d.az)}_el${Math.round(d.el)}`,
  }))
}

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
