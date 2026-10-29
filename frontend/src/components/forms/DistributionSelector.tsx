'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { DistributionMode, DistributionValue } from '@/lib/types'

// Re-export for convenience — consumers can import from here or from types
export type { DistributionMode, DistributionValue }

interface Props {
  label: string
  value: DistributionValue
  onChange: (value: DistributionValue) => void
  disabled?: boolean
  allowedTypes?: DistributionMode[]
  error?: string
}

const modeOptions = [
  { value: 'fixed', label: 'Determinista' },
  { value: 'normal', label: 'Normal (μ, σ)' },
  { value: 'uniform', label: 'Uniforme [min, max]' },
]

/**
 * Reusable distribution selector component for parametric values.
 *
 * Renders a mode dropdown ("Determinista" / "Normal" / "Uniforme") and
 * conditional numeric inputs for each mode. Used for dpo and target_kf
 * distribution configuration.
 */
export function DistributionSelector({ label, value, onChange, disabled, allowedTypes, error }: Props) {
  const filteredOptions = allowedTypes
    ? modeOptions.filter((o) => allowedTypes.includes(o.value as DistributionMode))
    : modeOptions
  const handleModeChange = (newMode: DistributionMode) => {
    if (newMode === value.mode) return

    if (newMode === 'fixed') {
      const v =
        value.mode === 'normal' ? value.mean
        : value.mode === 'uniform' ? value.min
        : 1.0
      onChange({ mode: 'fixed', value: v })
    } else if (newMode === 'normal') {
      const m =
        value.mode === 'fixed' ? value.value
        : value.mode === 'uniform' ? value.min
        : 1.0
      onChange({ mode: 'normal', mean: m, std: 0.1 * m })
    } else {
      const base =
        value.mode === 'fixed' ? value.value
        : value.mode === 'normal' ? value.mean
        : 1.0
      // R13.11: `min == base == max` was refused by the backend (`max must be
      // > min`), so switching an entry to uniform left a form that could not be
      // submitted until the user edited a bound by hand. A range around the
      // value already chosen is both submittable and the obvious starting point.
      // A base of 0 comes from clearing the `fixed` input (`parseFloat('') || 0`),
      // and bracketing it multiplicatively gives `{min: 0, max: 0}` - refused by
      // the API for both `min > 0` and `min < max`. The range is built on a
      // usable value instead, so the form stays submittable.
      const anchor = base > 0 ? base : 1.0
      onChange({ mode: 'uniform', min: anchor * 0.9, max: anchor * 1.1 })
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <Select
        value={value.mode}
        onChange={(e) => handleModeChange(e.target.value as DistributionMode)}
        disabled={disabled}
        options={filteredOptions}
      />

      {value.mode === 'fixed' && (
        <Input
          type="number"
          value={value.value}
          onChange={(e) =>
            onChange({ mode: 'fixed', value: parseFloat(e.target.value) || 0 })
          }
          disabled={disabled}
          step="any"
        />
      )}

      {value.mode === 'normal' && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            placeholder="μ"
            value={value.mean}
            onChange={(e) =>
              onChange({ ...value, mean: parseFloat(e.target.value) || 0 })
            }
            disabled={disabled}
            step="any"
          />
          <Input
            type="number"
            placeholder="σ"
            value={value.std}
            onChange={(e) =>
              onChange({ ...value, std: parseFloat(e.target.value) || 0 })
            }
            disabled={disabled}
            step="any"
          />
        </div>
      )}

      {value.mode === 'uniform' && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            placeholder="min"
            value={value.min}
            onChange={(e) =>
              onChange({ ...value, min: parseFloat(e.target.value) || 0 })
            }
            disabled={disabled}
            step="any"
          />
          <Input
            type="number"
            placeholder="max"
            value={value.max}
            onChange={(e) =>
              onChange({ ...value, max: parseFloat(e.target.value) || 0 })
            }
            disabled={disabled}
            step="any"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive mt-1">{error}</p>
      )}
    </div>
  )
}
