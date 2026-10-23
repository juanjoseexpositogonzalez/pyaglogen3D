'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useIsInsideAppShell } from '@/components/shell/AppShellContext'
import { aiApi } from '@/lib/ai-api'
import { Atom, FolderOpen, LayoutDashboard, LogIn, UserPlus, LogOut, User, Shield, Bot } from 'lucide-react'

const baseNavigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
]

/**
 * @deprecated Superseded by `components/shell/AppShell`, which mounts the
 * sidebar and top bar once in the root layout.
 *
 * Still exported because eighteen files import it. Rather than edit pages that
 * belong to later waves — some of them neighbours of files another change has
 * reserved — this renders nothing when the shell is already mounted, so no
 * route shows two navigations and no page changes an import. The wave that
 * rewrites the last of those pages deletes this file.
 */
export function Header() {
  const insideAppShell = useIsInsideAppShell()
  const pathname = usePathname()
  const { user, isAuthenticated, isLoading, logout } = useAuth()
  const [hasAIAccess, setHasAIAccess] = useState(false)

  useEffect(() => {
    async function checkAIAccess() {
      // The shell already asks. Running this too would double the request on
      // every one of the seventeen pages that still import this component.
      if (insideAppShell) return
      if (isAuthenticated) {
        try {
          const response = await aiApi.checkAccess()
          setHasAIAccess(response.has_access)
        } catch {
          setHasAIAccess(false)
        }
      } else {
        setHasAIAccess(false)
      }
    }
    checkAIAccess()
  }, [isAuthenticated, insideAppShell])

  // Build navigation dynamically based on AI access
  const navigation = hasAIAccess
    ? [...baseNavigation, { name: 'AI Assistant', href: '/ai', icon: Bot }]
    : baseNavigation

  if (insideAppShell) return null

  return (
    <header className="border-b border-white/10 bg-card/80 backdrop-blur-md">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Atom className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">pyAgloGen3D</span>
          </Link>

          {/* Navigation + Auth */}
          <nav className="flex items-center gap-6">
            {isAuthenticated && navigation.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              )
            })}

            {/* Admin link for staff users */}
            {isAuthenticated && user?.is_staff && (
              <Link
                href="/admin"
                className={cn(
                  'flex items-center gap-2 text-sm font-medium transition-colors',
                  pathname.startsWith('/admin')
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Shield className="h-4 w-4" />
                Admin
              </Link>
            )}

            {/* Auth section */}
            {!isLoading && (
              isAuthenticated ? (
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-4 w-4" />
                    {user?.first_name || user?.email}
                  </span>
                  <button
                    onClick={() => logout()}
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <Link
                    href="/auth/login"
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium transition-colors',
                      pathname === '/auth/login'
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </Link>
                  <Link
                    href="/auth/register"
                    className="flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 transition"
                  >
                    <UserPlus className="h-4 w-4" />
                    Register
                  </Link>
                </div>
              )
            )}
          </nav>
        </div>
      </div>
    </header>
  )
}
