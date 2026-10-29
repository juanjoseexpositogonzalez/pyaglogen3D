'use client'

/**
 * Shared settings panel for the Compare page (T16, change: visualize-multiple).
 *
 * Replaces the inline toolbar scaffolded in T12 (`CompareBody`'s buttons).
 * This is the only place the user controls:
 *
 *   - View mode (Grid | Overlay) — R-7
 *   - Camera sync (synced across viewers | independent) — R-6
 *
 * Sphere resolution, axes toggle, and background color are intentionally
 * deferred out of the MVP scope (see design.md §"Open questions for
 * TASKS" — we lean on `useViewerStore` defaults for now).
 */
import { Grid3x3, Layers, Link2, Unlink } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export type CompareMode = 'grid' | 'overlay'

interface CompareSettingsPanelProps {
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  synchronised: boolean
  onToggleSync: () => void
}

export function CompareSettingsPanel({
  mode,
  onModeChange,
  synchronised,
  onToggleSync,
}: CompareSettingsPanelProps): ReactNode {
  return (
    <div
      data-testid="compare-settings-panel"
      className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
    >
      <div
        role="group"
        aria-label="View mode"
        className="flex items-center gap-2"
      >
        <Label className="text-sm font-medium">View:</Label>
        <Button
          type="button"
          size="sm"
          variant={mode === 'grid' ? 'default' : 'ghost'}
          onClick={() => onModeChange('grid')}
          aria-pressed={mode === 'grid'}
          data-testid="compare-mode-grid"
        >
          <Grid3x3 className="mr-1 h-4 w-4" /> Grid
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'overlay' ? 'default' : 'ghost'}
          onClick={() => onModeChange('overlay')}
          aria-pressed={mode === 'overlay'}
          data-testid="compare-mode-overlay"
        >
          <Layers className="mr-1 h-4 w-4" /> Overlay
        </Button>
      </div>

      <div className="h-6 w-px bg-border" />

      <Button
        type="button"
        size="sm"
        variant={synchronised ? 'default' : 'outline'}
        onClick={onToggleSync}
        aria-pressed={synchronised}
        title={
          synchronised
            ? 'Click to use independent cameras'
            : 'Click to sync cameras'
        }
        data-testid="compare-sync-toggle"
      >
        {synchronised ? (
          <Link2 className="mr-1 h-4 w-4" />
        ) : (
          <Unlink className="mr-1 h-4 w-4" />
        )}
        {synchronised ? 'Synced' : 'Independent'}
      </Button>
    </div>
  )
}
