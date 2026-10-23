'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
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
  return match ? match[1] : null
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

  if (rest.startsWith('/simulations')) return [project, { label: 'Simulation' }]
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
  const searchParams = useSearchParams()
  const { user, isAuthenticated, logout } = useAuth()

  const [hasAiAccess, setHasAiAccess] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

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

  if (chromeless || !isAuthenticated) {
    return <>{children}</>
  }

  const sidebar = (
    <Sidebar
      pathname={pathname}
      section={searchParams?.get('section') ?? null}
      project={project ? { id: project.id, name: project.name } : null}
      hasAiAccess={hasAiAccess}
      isAdmin={Boolean(user?.is_staff)}
    />
  )

  return (
    <AppShellProvider>
      <div className="min-h-screen bg-shell">
        {/* Fixed rail from 900px up. */}
        <div className="fixed inset-y-0 left-0 z-40 hidden w-[246px] lg:block">{sidebar}</div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-[rgba(16,43,61,.45)]"
            />
            <div ref={drawerRef} className="absolute inset-y-0 left-0 w-[246px]">
              {sidebar}
            </div>
          </div>
        )}

        <div className={cn('min-w-0', 'lg:ml-[246px]')}>
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
            onOpenNavigation={() => setDrawerOpen(true)}
            onSignOut={() => logout()}
          />
          <main className="mx-auto w-full max-w-[1440px] px-10 pb-14 pt-9">{children}</main>
        </div>
      </div>
    </AppShellProvider>
  )
}

export default AppShell
