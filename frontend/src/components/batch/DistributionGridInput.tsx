'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DistributionSelector } from '@/components/forms/DistributionSelector'
import { Plus, Trash2 } from 'lucide-react'
import type { DistributionMode, DistributionValue } from '@/lib/types'

interface DistributionGridInputProps {
  value: DistributionValue[]
  onChange: (configs: DistributionValue[]) => void
  label: string
  allowedTypes?: DistributionMode[]
  minEntries?: number
}

const DEFAULT_ENTRY: DistributionValue = { mode: 'fixed', value: 1.0 }

export function DistributionGridInput({
  value,
  onChange,
  label,
  allowedTypes,
  minEntries = 1,
}: DistributionGridInputProps) {
  const handleAdd = () => {
    onChange([...value, { ...DEFAULT_ENTRY }])
  }

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const handleChildChange = (index: number, newVal: DistributionValue) => {
    const updated = [...value]
    updated[index] = newVal
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          aria-label="Add distribution"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {value.map((entry, index) => (
        <div key={index} className="flex items-start gap-2 p-2 border rounded bg-muted/30">
          <div className="flex-1">
            <DistributionSelector
              label={`#${index + 1}`}
              value={entry}
              onChange={(newVal) => handleChildChange(index, newVal)}
              allowedTypes={allowedTypes}
            />
          </div>
          {value.length > minEntries && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(index)}
              aria-label="Remove distribution"
              className="mt-6"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
