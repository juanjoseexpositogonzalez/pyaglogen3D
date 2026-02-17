import { Badge } from '@/components/ui/badge'
import type { SimulationStatus, AnalysisStatus } from '@/lib/types'

type Status = SimulationStatus | AnalysisStatus

interface StatusBadgeProps {
  status: Status
}

const statusConfig: Record<Status, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'warning' }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  running: { label: 'Running', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge variant={config.variant}>
      {status === 'running' && (
        <span className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-current" />
      )}
      {config.label}
    </Badge>
  )
}
