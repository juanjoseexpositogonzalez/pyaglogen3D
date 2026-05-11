import { Badge } from '@/components/ui/badge'
import type { NeighborGraphStats } from '@/lib/types'

interface StatsBannerProps {
  stats: NeighborGraphStats
}

/**
 * Presentational 4-card stats grid for topology graph.
 * Extracted from NeighborGraph.tsx lines 92-112.
 */
export default function StatsBanner({ stats }: StatsBannerProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="text-center p-3 bg-muted/50 rounded-lg">
        <p className="text-2xl font-bold">{stats.n_particles}</p>
        <p className="text-xs text-muted-foreground">Particles</p>
      </div>
      <div className="text-center p-3 bg-muted/50 rounded-lg">
        <p className="text-2xl font-bold">{stats.n_edges}</p>
        <p className="text-xs text-muted-foreground">Connections</p>
      </div>
      <div className="text-center p-3 bg-muted/50 rounded-lg">
        <p className="text-2xl font-bold">{stats.avg_coordination.toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">Avg. Coordination</p>
      </div>
      <div className="text-center p-3 bg-muted/50 rounded-lg">
        <Badge variant={stats.is_connected ? 'default' : 'destructive'}>
          {stats.is_connected ? 'Connected' : 'Disconnected'}
        </Badge>
        <p className="text-xs text-muted-foreground mt-1">Graph Status</p>
      </div>
    </div>
  )
}
