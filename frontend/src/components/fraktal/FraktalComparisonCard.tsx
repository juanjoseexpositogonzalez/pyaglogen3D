'use client'

import { Info } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { FraktalBatchComparison } from '@/lib/api'

interface FraktalComparisonCardProps {
  comparison: FraktalBatchComparison
}

function formatDf(v: number | null): string {
  return v === null ? '—' : v.toFixed(3)
}

export function FraktalComparisonCard({
  comparison,
}: FraktalComparisonCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Df Comparison</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {/* Batch mean */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">FRAKTAL mean</div>
            <div className="text-xl font-mono font-semibold">
              {formatDf(comparison.batch_mean_df)}
            </div>
            {comparison.batch_std_df !== null && (
              <div className="text-xs text-muted-foreground">
                ± {comparison.batch_std_df.toFixed(3)}
              </div>
            )}
          </div>

          {/* Simulation target */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Sim target</div>
            <div className="text-xl font-mono font-semibold">
              {formatDf(comparison.sim_target_df)}
            </div>
            {comparison.sim_name && (
              <div className="text-xs text-muted-foreground truncate">
                {comparison.sim_name}
              </div>
            )}
          </div>

          {/* Simulation 3D box-counting */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">
              Sim 3D box-counting
            </div>
            <div className="text-xl font-mono font-semibold">
              {formatDf(comparison.sim_box_counting_df)}
            </div>
            <div className="text-xs text-muted-foreground">from engine</div>
          </div>
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-xs flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{comparison.sorensen_note}</span>
        </div>
      </CardContent>
    </Card>
  )
}
