'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { Atom, FolderOpen, LayoutDashboard, LogIn, UserPlus, LogOut, User, Shield, Bot } from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'AI Assistant', href: '/ai', icon: Bot },
]

export function Header() {
  const pathname = usePathname()
  const { user, isAuthenticated, isLoading, logout } = useAuth()

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
