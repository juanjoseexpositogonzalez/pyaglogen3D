import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface MetricsCardProps {
  label: string
  value: string | number
  subvalue?: string
  icon?: React.ReactNode
  className?: string
}

export function MetricsCard({
  label,
  value,
  subvalue,
  icon,
  className,
}: MetricsCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subvalue && (
              <p className="text-xs text-muted-foreground mt-0.5">{subvalue}</p>
            )}
          </div>
          {icon && (
            <div className="text-muted-foreground">{icon}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

interface MetricsGridProps {
  children: React.ReactNode
  className?: string
}

export function MetricsGrid({ children, className }: MetricsGridProps) {
  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-4', className)}>
      {children}
    </div>
  )
}
