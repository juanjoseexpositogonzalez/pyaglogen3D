'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { adminApi, AdminDashboardData, AdminUser } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import {
  Users,
  FolderOpen,
  Atom,
  ChevronDown,
  ChevronRight,
  Mail,
  Calendar,
  Shield,
} from 'lucide-react'

export default function AdminPage() {
  const router = useRouter()
  const { isLoading: authLoading, isAuthenticated, user } = useAuth()
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())

  // Check auth and admin status
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
      return
    }

    if (!authLoading && user && !user.is_staff) {
      router.push('/dashboard')
      return
    }
  }, [authLoading, isAuthenticated, user, router])

  // Fetch admin data
  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.is_staff) {
      fetchAdminData()
    }
  }, [authLoading, isAuthenticated, user])

  const fetchAdminData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await adminApi.getDashboard()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleUserExpand = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  // Show loading while checking auth
  if (authLoading) {
    return <LoadingScreen message="Checking authentication..." />
  }

  // Don't render if not authenticated or not admin
  if (!isAuthenticated || !user?.is_staff) {
    return <LoadingScreen message="Redirecting..." />
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="h-8 w-8" />
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              Overview of all users and projects
            </p>
          </div>
          <Button onClick={fetchAdminData} variant="outline">
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <LoadingScreen message="Loading admin data..." />
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="p-6">
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Users
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{data.summary.total_users}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Projects
                  </CardTitle>
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{data.summary.total_projects}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Simulations
                  </CardTitle>
                  <Atom className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{data.summary.total_simulations}</div>
                </CardContent>
              </Card>
            </div>

            {/* Users List */}
            <h2 className="text-xl font-semibold mb-4">All Users</h2>
            <div className="space-y-4">
              {data.users.map((adminUser) => (
                <UserCard
                  key={adminUser.id}
                  user={adminUser}
                  isExpanded={expandedUsers.has(adminUser.id)}
                  onToggle={() => toggleUserExpand(adminUser.id)}
                />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}

function UserCard({
  user,
  isExpanded,
  onToggle,
}: {
  user: AdminUser
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={onToggle}
        >
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="p-0 h-auto">
              {isExpanded ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </Button>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {user.full_name || user.email}
                {user.is_staff && (
                  <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                    Admin
                  </span>
                )}
                {!user.email_verified && (
                  <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded">
                    Unverified
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {user.email}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </span>
                {user.oauth_provider && (
                  <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                    {user.oauth_provider}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <FolderOpen className="h-4 w-4" />
              {user.project_count} projects
            </span>
            <span className="flex items-center gap-1">
              <Atom className="h-4 w-4" />
              {user.simulation_count} sims
            </span>
          </div>
        </div>
      </CardHeader>

      {isExpanded && user.projects.length > 0 && (
        <CardContent className="pt-0">
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-3">Projects</h4>
            <div className="space-y-2">
              {user.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                    <div>
                      <p className="font-medium">{project.name}</p>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {project.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{project.simulation_count} sims</span>
                      <span>{project.study_count} studies</span>
                      <span>{new Date(project.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </CardContent>
      )}

      {isExpanded && user.projects.length === 0 && (
        <CardContent className="pt-0">
          <div className="border-t pt-4">
            <p className="text-sm text-muted-foreground">No projects yet</p>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
