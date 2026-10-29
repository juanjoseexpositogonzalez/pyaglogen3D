'use client'

/**
 * Metrics table for the Compare page (T14, change: visualize-multiple).
 *
 * One column per simulation (palette-colored header dot + sim name),
 * one row per metric. Radius of gyration is scaled to nm using each
 * sim's own `getScaleFactorNm(parameters)` (R-5 in the spec).
 *
 * The component is deliberately dumb: it only reads the props, applies
 * the scale factor for the Rg row, and em-dashes missing values. The
 * page owns the mapping from `Simulation` → `MetricsRow`.
 */
import type { ReactNode } from 'react'

import { getScaleFactorNm } from '@/lib/units'

import type { CompareSim } from './CompareGrid'

/**
 * Metrics shape the table consumes. All numeric fields are nullable so
 * imported aggregates (which may be missing Df/kf) still render a column.
 * `radius_of_gyration` is in engine units — the table does the nm scaling.
 */
export interface CompareSimMetrics {
  fractal_dimension: number | null
  prefactor: number | null
  radius_of_gyration: number | null
  n_particles: number | null
}

/**
 * `CompareGrid`'s `CompareSim` plus the metric/algorithm fields needed by
 * this table. Kept as a structural extension rather than a replacement to
 * avoid dragging metric concerns into the grid/overlay components.
 */
export interface CompareSimWithMetrics extends CompareSim {
  metrics: CompareSimMetrics | null
  algorithm: string | null
}

interface CompareMetricsTableProps {
  simulations: CompareSimWithMetrics[]
  /** id → palette color map (shared with grid + overlay). */
  colorMap: Record<string, string>
}

function formatNumber(
  value: number | null | undefined,
  digits: number,
): string {
  if (value === null || value === undefined) return '—'
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function CompareMetricsTable({
  simulations,
  colorMap,
}: CompareMetricsTableProps): ReactNode {
  return (
    <div
      data-testid="compare-metrics-table"
      className="overflow-x-auto rounded-lg border"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="p-2 text-left font-semibold">Metric</th>
            {simulations.map((sim) => {
              const color = colorMap[sim.id] ?? '#999999'
              return (
                <th
                  key={sim.id}
                  data-testid="compare-metrics-header"
                  data-sim-id={sim.id}
                  data-color={color}
                  className="p-2 text-right font-semibold"
                >
                  <div className="flex items-center justify-end gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="max-w-[150px] truncate">{sim.name}</span>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="p-2 font-medium">Fractal Dimension (Df)</td>
            {simulations.map((sim) => (
              <td
                key={sim.id}
                data-testid="metrics-cell-df"
                data-sim-id={sim.id}
                className="p-2 text-right font-mono"
              >
                {formatNumber(sim.metrics?.fractal_dimension, 3)}
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <td className="p-2 font-medium">Prefactor (kf)</td>
            {simulations.map((sim) => (
              <td
                key={sim.id}
                data-testid="metrics-cell-kf"
                data-sim-id={sim.id}
                className="p-2 text-right font-mono"
              >
                {formatNumber(sim.metrics?.prefactor, 3)}
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <td className="p-2 font-medium">Radius of Gyration (nm)</td>
            {simulations.map((sim) => {
              // Engine Rg → nm via the sim's own scale factor.
              const rgEngine = sim.metrics?.radius_of_gyration
              const rgNm =
                rgEngine !== null && rgEngine !== undefined
                  ? rgEngine * getScaleFactorNm(sim.parameters)
                  : null
              return (
                <td
                  key={sim.id}
                  data-testid="metrics-cell-rg"
                  data-sim-id={sim.id}
                  className="p-2 text-right font-mono"
                >
                  {formatNumber(rgNm, 2)}
                </td>
              )
            })}
          </tr>
          <tr className="border-b">
            <td className="p-2 font-medium">N particles</td>
            {simulations.map((sim) => (
              <td
                key={sim.id}
                data-testid="metrics-cell-n"
                data-sim-id={sim.id}
                className="p-2 text-right font-mono"
              >
                {sim.metrics?.n_particles ?? '—'}
              </td>
            ))}
          </tr>
          <tr>
            <td className="p-2 font-medium">Algorithm</td>
            {simulations.map((sim) => (
              <td
                key={sim.id}
                data-testid="metrics-cell-algorithm"
                data-sim-id={sim.id}
                className="p-2 text-right"
              >
                {sim.algorithm ?? '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
