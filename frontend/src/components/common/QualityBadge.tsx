import { cn } from '@/lib/utils'
import type { AnalysisQuality } from '@/lib/api'

const styles: Record<AnalysisQuality, string> = {
  converged: 'bg-green-100 text-green-800 border-green-300',
  approximate: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  excluded: 'bg-gray-100 text-gray-700 border-gray-300',
  failed: 'bg-red-100 text-red-800 border-red-300',
}

const labels: Record<AnalysisQuality, string> = {
  converged: 'Converged',
  approximate: 'Approximate',
  excluded: 'Excluded',
  failed: 'Failed',
}

export function QualityBadge({
  quality,
  className,
}: {
  quality: AnalysisQuality
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-block px-2 py-0.5 text-xs font-medium rounded border',
        styles[quality],
        className,
      )}
    >
      {labels[quality]}
    </span>
  )
}
