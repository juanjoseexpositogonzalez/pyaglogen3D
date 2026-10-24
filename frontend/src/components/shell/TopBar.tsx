'use client'

import { Bell, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react'
import Link from 'next/link'

import { SegmentedControl } from '@/components/kit/SegmentedControl'
import { useThemeStore } from '@/stores/useThemeStore'
import { cn } from '@/lib/utils'
import type { ThemePreference } from '@/lib/theme'

/**
 * The sticky bar above the page frame: where you are, how it looks, who you
 * are.
 */
export interface Crumb {
  label: string
  href?: string
}

export interface TopBarProps {
  /** Context trail; the last entry is the current entity and is emphasised. */
  crumbs?: Crumb[]
  user?: { name: string; initials: string } | null
  notifications?: number
  /**
   * Shown only while the sidebar is a drawer. Receives its own trigger so the
   * shell can return focus there when the drawer closes.
   */
  onOpenNavigation?: (trigger: HTMLElement) => void
  onSignOut?: () => void
  environment?: string | null
  className?: string
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const THEME_ICON: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

export function TopBar({
  crumbs = [],
  user,
  notifications = 0,
  onOpenNavigation,
  onSignOut,
  environment,
  className,
}: TopBarProps) {
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)
  const ActiveIcon = THEME_ICON[preference]

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 border-b border-line bg-[var(--topbar-background)] px-9 backdrop-blur-md',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {onOpenNavigation && (
          <button
            type="button"
            onClick={(event) => onOpenNavigation(event.currentTarget)}
            aria-label="Open navigation"
            className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-muted lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1
              return (
                <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {crumb.href && !last ? (
                    <Link href={crumb.href} className="truncate hover:text-ink">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={last ? 'page' : undefined}
                      className={cn('truncate', last && 'font-semibold text-ink')}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3.5">
        {environment && (
          <span className="rounded-full border border-line bg-brand-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.04em] text-brand-strong">
            {environment}
          </span>
        )}

        {/* Full control where it fits. */}
        <span className="hidden items-center gap-2 md:flex">
          <ActiveIcon className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
          <SegmentedControl
            size="sm"
            ariaLabel="Theme"
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
          />
        </span>

        {/*
          On a phone the segmented control does not fit, but hiding it with no
          alternative left those users unable to change theme at all. This
          cycles System to Light to Dark and names the next state, so the
          action is announced rather than guessed.
        */}
        <button
          type="button"
          onClick={() => {
            const order: ThemePreference[] = ['system', 'light', 'dark']
            const next = order[(order.indexOf(preference) + 1) % order.length]
            setPreference(next)
          }}
          aria-label={`Theme: ${preference}. Activate for ${
            preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system'
          }.`}
          className="grid h-9 w-9 place-items-center rounded-md text-ink-muted transition-colors hover:bg-accent hover:text-ink md:hidden"
        >
          <ActiveIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label={
            notifications > 0 ? `Notifications, ${notifications} unread` : 'Notifications'
          }
          className="relative grid h-9 w-9 place-items-center rounded-md text-ink-muted transition-colors hover:bg-accent hover:text-ink"
        >
          <Bell className="h-4 w-4" />
          {notifications > 0 && (
            <span className="num absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {notifications}
            </span>
          )}
        </button>

        {user && (
          <span className="flex items-center gap-2.5">
            <Link
              href="/settings"
              className="flex items-center gap-2 text-[11px] font-bold text-ink-muted transition-colors hover:text-ink"
            >
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-brand-soft text-[11px] font-extrabold text-brand-strong">
                {user.initials}
              </span>
              <span className="hidden max-w-[145px] truncate lg:block">{user.name}</span>
            </Link>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                className="grid h-9 w-9 place-items-center rounded-md text-ink-muted transition-colors hover:bg-accent hover:text-ink"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </span>
        )}
      </div>
    </header>
  )
}

export default TopBar
