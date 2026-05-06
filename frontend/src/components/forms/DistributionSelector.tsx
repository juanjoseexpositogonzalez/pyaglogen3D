'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

export type DistributionMode = 'fixed' | 'normal' | 'uniform'

export type DistributionValue =
  | { mode: 'fixed'; value: number }
  | { mode: 'normal'; mean: number; std: number }
  | { mode: 'uniform'; min: number; max: number }

interface Props {
  label: string
  value: DistributionValue
  onChange: (value: DistributionValue) => void
  disabled?: boolean
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
export function DistributionSelector({ label, value, onChange, disabled }: Props) {
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
      onChange({ mode: 'uniform', min: base, max: base })
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <Select
        value={value.mode}
        onChange={(e) => handleModeChange(e.target.value as DistributionMode)}
        disabled={disabled}
        options={modeOptions}
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
    </div>
  )
}
