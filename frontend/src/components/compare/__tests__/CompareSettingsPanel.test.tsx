/**
 * Unit tests for `<CompareSettingsPanel>` (T16/T19, change: visualize-multiple).
 *
 * Coverage:
 *   - `mode` prop drives which button is marked active (aria-pressed).
 *   - onModeChange fires with the opposite mode on click.
 *   - `synchronised` drives the sync button label ("Synced" vs "Independent").
 *   - onToggleSync fires on click.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CompareSettingsPanel } from '../CompareSettingsPanel'

describe('<CompareSettingsPanel />', () => {
  it('marks Grid active when mode="grid"', () => {
    render(
      <CompareSettingsPanel
        mode="grid"
        onModeChange={() => {}}
        synchronised={true}
        onToggleSync={() => {}}
      />,
    )
    expect(
      screen.getByTestId('compare-mode-grid').getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByTestId('compare-mode-overlay').getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('marks Overlay active when mode="overlay"', () => {
    render(
      <CompareSettingsPanel
        mode="overlay"
        onModeChange={() => {}}
        synchronised={true}
        onToggleSync={() => {}}
      />,
    )
    expect(
      screen.getByTestId('compare-mode-overlay').getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByTestId('compare-mode-grid').getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('fires onModeChange("overlay") when overlay clicked from grid', () => {
    const onModeChange = vi.fn()
    render(
      <CompareSettingsPanel
        mode="grid"
        onModeChange={onModeChange}
        synchronised={true}
        onToggleSync={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('compare-mode-overlay'))
    expect(onModeChange).toHaveBeenCalledWith('overlay')
  })

  it('fires onModeChange("grid") when grid clicked from overlay', () => {
    const onModeChange = vi.fn()
    render(
      <CompareSettingsPanel
        mode="overlay"
        onModeChange={onModeChange}
        synchronised={true}
        onToggleSync={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('compare-mode-grid'))
    expect(onModeChange).toHaveBeenCalledWith('grid')
  })

  it('shows "Synced" label when synchronised=true', () => {
    render(
      <CompareSettingsPanel
        mode="grid"
        onModeChange={() => {}}
        synchronised={true}
        onToggleSync={() => {}}
      />,
    )
    const btn = screen.getByTestId('compare-sync-toggle')
    expect(btn.textContent).toContain('Synced')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows "Independent" label when synchronised=false', () => {
    render(
      <CompareSettingsPanel
        mode="grid"
        onModeChange={() => {}}
        synchronised={false}
        onToggleSync={() => {}}
      />,
    )
    const btn = screen.getByTestId('compare-sync-toggle')
    expect(btn.textContent).toContain('Independent')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('fires onToggleSync when sync button clicked', () => {
    const onToggleSync = vi.fn()
    render(
      <CompareSettingsPanel
        mode="grid"
        onModeChange={() => {}}
        synchronised={true}
        onToggleSync={onToggleSync}
      />,
    )
    fireEvent.click(screen.getByTestId('compare-sync-toggle'))
    expect(onToggleSync).toHaveBeenCalledTimes(1)
  })
})
