'use client'

/**
 * Metrics table for the Compare page (T14, change: visualize-multiple;
 * migrated to the design-system kit by issue #175, slice 2).
 *
 * One column per simulation (palette-coloured header marker + sim name), one
 * row per metric. Radius of gyration is scaled to nm using each sim's own
 * `getScaleFactorNm(parameters)` (R-5 in the spec).
 *
 * The component is deliberately dumb: it only reads the props, applies the
 * scale factor for the Rg row, and lets `Num` em-dash missing values. The page
 * owns the mapping from `Simulation` → `MetricsRow`.
 *
 * The table itself is the kit's `DataTable`, so this screen gets the same 12px
 * rows, sticky-able header, hairline separators and tabular numbers as the rest
 * of the product, rather than a second table built to look like it. Every
 * reading renders through `Num`, which is what keeps a number and its unit two
 * elements instead of one string.
 */
import type { ReactNode } from 'react'

import { getScaleFactorNm } from '@/lib/units'

import { DataTable, type Column } from '@/components/kit/DataTable'
import { Num } from '@/components/kit/Num'

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

/**
 * One row of the table: a metric, and how to read it off a simulation.
 *
 * The row carries the unit and the precision because they belong to the
 * quantity, not to the column — every column shows the same five quantities.
 */
interface MetricRow {
  key: string
  label: string
  /** Unit symbol, rendered apart from the number by `Num`. */
  unit?: string
  /** Decimal places. */
  digits?: number
  /** The reading for one simulation, in the unit this row prints. */
  read: (sim: CompareSimWithMetrics) => number | null
  /** For a row that is not a reading at all: the algorithm's name. */
  text?: (sim: CompareSimWithMetrics) => string | null
}

const METRIC_ROWS: MetricRow[] = [
  {
    key: 'df',
    label: 'Fractal Dimension (Df)',
    digits: 3,
    read: (sim) => sim.metrics?.fractal_dimension ?? null,
  },
  {
    key: 'kf',
    label: 'Prefactor (kf)',
    digits: 3,
    read: (sim) => sim.metrics?.prefactor ?? null,
  },
  {
    key: 'rg',
    label: 'Radius of Gyration',
    unit: 'nm',
    digits: 2,
    // Engine Rg → nm via this simulation's own scale factor.
    read: (sim) => {
      const engine = sim.metrics?.radius_of_gyration
      return engine === null || engine === undefined
        ? null
        : engine * getScaleFactorNm(sim.parameters)
    },
  },
  {
    key: 'n',
    label: 'N particles',
    digits: 0,
    read: (sim) => sim.metrics?.n_particles ?? null,
  },
  {
    key: 'algorithm',
    label: 'Algorithm',
    read: () => null,
    text: (sim) => sim.algorithm,
  },
]

/**
 * What the table is, said once. A reader who reaches the table without the
 * chart beside it has only these words to know what a column means.
 */
const CAPTION =
  'Engine readings, one column per simulation; radius of gyration is scaled to nm with each simulation’s own particle diameter.'

/** A simulation's column: its palette marker and name over its own readings. */
function simulationColumn(
  sim: CompareSimWithMetrics,
  color: string,
): Column<MetricRow> {
  return {
    key: sim.id,
    numeric: true,
    header: (
      <span className="inline-flex items-center justify-end gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="max-w-[150px] truncate">{sim.name}</span>
      </span>
    ),
    render: (row) =>
      row.text ? (
        (row.text(sim) ?? '—')
      ) : (
        <Num
          value={row.read(sim)}
          unit={row.unit}
          digits={row.digits}
          size="sm"
        />
      ),
  }
}

export function CompareMetricsTable({
  simulations,
  colorMap,
}: CompareMetricsTableProps): ReactNode {
  const columns: Column<MetricRow>[] = [
    { key: 'metric', header: 'Metric', render: (row) => row.label },
  ]

  for (let index = 0; index < simulations.length; index++) {
    const sim = simulations[index]
    // One identity, four surfaces: this is the same map the chart, the grid and
    // the overlay read, so a simulation's marker here is the colour of its
    // curve and of its grid cell. The map is total for the ids the page passes
    // (see `getCompareColorPalette`), which is why there is no substitute value
    // here — a grey invented on this surface would be half an identity.
    columns.push(simulationColumn(sim, colorMap[sim.id]))
  }

  return (
    <DataTable
      columns={columns}
      rows={METRIC_ROWS}
      rowKey={(row) => row.key}
      caption={CAPTION}
    />
  )
}
