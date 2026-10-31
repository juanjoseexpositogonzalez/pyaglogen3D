'use client'

import { useEffect, useState } from 'react'
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
  /** The grid key these entries edit; forwarded so the mirror can cap it. */
  parameterName?: string
}

const DEFAULT_ENTRY: DistributionValue = { mode: 'fixed', value: 1.0 }

// Monotonic, so an entry keeps its key when its neighbours are removed.
let nextEntryId = 0

export function DistributionGridInput({
  value,
  onChange,
  label,
  allowedTypes,
  minEntries = 1,
  parameterName,
}: DistributionGridInputProps) {
  // Rows used to be keyed by index, which made every bit of row state belong to
  // the POSITION: deleting a row handed its state to its neighbour. R8.4's
  // "already blurred" flag lived there, so a row nobody touched appeared red and
  // a row the user had touched lost its message - both measured by the judges of
  // PR #199. Entries now carry an identity that survives deletion; an update
  // coming from outside this component (a parent resetting the field) falls back
  // to position, which is the best that can be done without an id in the payload.
  const [ids, setIds] = useState<string[]>(() =>
    value.map(() => `entry-${nextEntryId++}`),
  )

  useEffect(() => {
    setIds((prev) =>
      prev.length === value.length
        ? prev
        : value.map((_, index) => prev[index] ?? `entry-${nextEntryId++}`),
    )
  }, [value.length])

  const handleAdd = () => {
    setIds((prev) => [...prev, `entry-${nextEntryId++}`])
    onChange([...value, { ...DEFAULT_ENTRY }])
  }

  const handleRemove = (index: number) => {
    setIds((prev) => prev.filter((_, i) => i !== index))
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
        <div key={ids[index] ?? index} className="flex items-start gap-2 p-2 border rounded bg-muted/30">
          <div className="flex-1">
            <DistributionSelector
              label={`#${index + 1}`}
              value={entry}
              onChange={(newVal) => handleChildChange(index, newVal)}
              allowedTypes={allowedTypes}
              parameterName={parameterName}
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
