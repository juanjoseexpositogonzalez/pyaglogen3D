'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { aiApi } from '@/lib/ai-api'
import { useProject } from '@/hooks/useProjects'
import { cn } from '@/lib/utils'

import { AppShellProvider } from './AppShellContext'
import { Sidebar } from './Sidebar'
import { TopBar, type Crumb } from './TopBar'

/**
 * Routes that carry their own layout and must never be wrapped in the shell.
 *
 * `middleware.ts` protects only `/dashboard` and `/projects`, and redirects an
 * authenticated user away from the auth routes. A sidebar with a breadcrumb
 * and a user menu over a sign-in form would be incoherent, so the guard lives
 * here rather than in a route group: as a prop-driven component it can be
 * asserted in a test, which a route group cannot.
 */
function isChromeless(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/auth/')
}

/** Extract the project id from any project-scoped route. */
function projectIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/?]+)/)
  // `/projects/new` is the creation form, not a project: treating it as an id
  // fires a doomed API request and shows a breadcrumb pointing back at itself.
  if (!match || match[1] === 'new') return null
  return match[1]
}

function crumbsFor(pathname: string, projectName?: string): Crumb[] {
  if (pathname.startsWith('/dashboard')) return [{ label: 'Dashboard' }]
  if (pathname === '/projects') return [{ label: 'Projects' }]
  if (pathname.startsWith('/admin')) return [{ label: 'Admin' }, { label: 'Users' }]
  if (pathname.startsWith('/ai')) return [{ label: 'AI Assistant' }]
  if (pathname.startsWith('/settings')) return [{ label: 'Settings' }]

  const id = projectIdFrom(pathname)
  if (!id) return []

  const project: Crumb = { label: projectName ?? 'Project', href: `/projects/${id}` }
  const rest = pathname.slice(`/projects/${id}`.length)

  // Naming the type ("Simulation") rather than the entity leaves the bar
  // saying the same thing on every simulation. Until the entity's own name is
  // available here, the identifier is at least unique to the entity.
  const tail = rest.split('/').filter(Boolean)
  const idOf = (index: number) => (tail[index] ? ` ${tail[index]}` : '')

  if (rest.startsWith('/simulations/new')) return [project, { label: 'New simulation' }]
  if (rest.startsWith('/simulations')) return [project, { label: `Simulation${idOf(1)}` }]
  if (rest.startsWith('/batch')) return [project, { label: 'Batch study' }]
  if (rest.startsWith('/compare')) return [project, { label: 'Compare' }]
  if (rest.startsWith('/fraktal/batch')) return [project, { label: 'FRAKTAL batch' }]
  if (rest.startsWith('/fraktal')) return [project, { label: 'FRAKTAL analysis' }]
  return [project]
}

export interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname() ?? '/'
  const { user, isAuthenticated, isLoading, logout } = useAuth()

  const [hasAiAccess, setHasAiAccess] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  const chromeless = isChromeless(pathname)
  const projectId = projectIdFrom(pathname)
  const { data: project } = useProject(projectId ?? '')

  useEffect(() => {
    if (!isAuthenticated) {
      setHasAiAccess(false)
      return
    }
    let cancelled = false
    aiApi
      .checkAccess()
      .then((response) => {
        if (!cancelled) setHasAiAccess(Boolean(response?.has_access))
      })
      .catch(() => {
        if (!cancelled) setHasAiAccess(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  // Close the drawer on navigation: leaving it open over the new page is the
  // classic way a mobile menu swallows the next tap.
  useEffect(() => setDrawerOpen(false), [pathname])

  // Icons only between 1024 and 1439px. The three-panel screens, AI assistant
  // and compare, lose real working width to a 246px rail at those sizes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1439px)')
    const apply = () => setCollapsed(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  // B-005: a drawer that does not trap focus lets the keyboard wander into the
  // page it is covering, which is invisible to a sighted user and disorienting
  // to everyone else.
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    restoreFocusTo.current?.focus()
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const node = drawerRef.current
    if (!node) return

    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      )

    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDrawer()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, closeDrawer])


  const sidebar = (collapsedRail: boolean) => (
    <Sidebar
      pathname={pathname}
      project={project ? { id: project.id, name: project.name } : null}
      hasAiAccess={hasAiAccess}
      isAdmin={Boolean(user?.is_staff)}
      collapsed={collapsedRail}
    />
  )

  // The tree shape must not depend on auth state. An earlier version returned
  // a bare fragment until `isAuthenticated` flipped, which changes the element
  // type at the children position: React then unmounts and remounts the whole
  // page on every load, losing local state, re-running every effect and
  // re-issuing every query. The frame is always rendered; only its chrome is
  // conditional.
  const showChrome = !chromeless && isAuthenticated && !isLoading

  return (
    <AppShellProvider value={showChrome}>
      <div className={cn('min-h-screen', showChrome && 'bg-shell')}>
        {/* Fixed rail from 900px up. */}
        {showChrome && <div
          className={cn(
            'fixed inset-y-0 left-0 z-40 hidden lg:block',
            collapsed ? 'w-[68px]' : 'w-[246px]',
          )}
        >
          {sidebar(collapsed)}
        </div>}

        {showChrome && drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={closeDrawer}
              className="absolute inset-0 bg-rail-scrim"
            />
            <div ref={drawerRef} className="absolute inset-y-0 left-0 w-[246px]">
              {sidebar(false)}
            </div>
          </div>
        )}

        <div
          className={cn('min-w-0', showChrome && (collapsed ? 'lg:ml-[68px]' : 'lg:ml-[246px]'))}
        >
          {showChrome && (
          <TopBar
            crumbs={crumbsFor(pathname, project?.name)}
            user={
              user
                ? {
                    name: user.full_name || user.email,
                    initials: (user.first_name?.[0] ?? user.email[0] ?? '?').toUpperCase(),
                  }
                : null
            }
            onOpenNavigation={(trigger) => {
              restoreFocusTo.current = trigger
              setDrawerOpen(true)
            }}
            onSignOut={() => logout()}
          />
          )}
          {/*
            `<main>` renders unconditionally. An earlier attempt swapped it for
            a bare `children`, which is a different element type at the same
            position: React unmounts and remounts the whole page when
            authentication resolves, and every load passes through that
            transition. `display: contents` keeps the chromeless layout
            untouched without removing the element.
          */}
          <main
            className={cn(
              showChrome ? 'mx-auto w-full max-w-[1440px] px-10 pb-14 pt-9' : 'contents',
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </AppShellProvider>
  )
}

export default AppShell
