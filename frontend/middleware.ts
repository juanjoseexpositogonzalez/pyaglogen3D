/**
 * Next.js middleware for route protection.
 *
 * Protects dashboard and project routes from unauthenticated access.
 * Redirects authenticated users away from auth pages.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require authentication
const protectedRoutes = ['/dashboard', '/projects']

// Routes that should redirect authenticated users
const authRoutes = ['/auth/login', '/auth/register']

// Check if path starts with any of the given prefixes
function matchesRoute(path: string, routes: string[]): boolean {
  return routes.some((route) => path === route || path.startsWith(`${route}/`))
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check for refresh token in cookies/localStorage
  // Note: We can only check cookies in middleware, not localStorage
  // The actual auth check will happen client-side
  // This middleware provides basic redirect logic based on cookie presence

  const hasRefreshToken = request.cookies.has('pyaglogen3d_auth')

  // Redirect unauthenticated users from protected routes to login
  if (matchesRoute(pathname, protectedRoutes) && !hasRefreshToken) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users from auth pages to dashboard
  if (matchesRoute(pathname, authRoutes) && hasRefreshToken) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api).*)',
  ],
}
