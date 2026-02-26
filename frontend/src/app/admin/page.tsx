'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { adminApi, AdminDashboardData, AdminUser } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
  Trash2,
  Edit2,
  Save,
  X,
  AlertTriangle,
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

  const handleUserUpdate = (updatedUser: AdminUser) => {
    if (data) {
      setData({
        ...data,
        users: data.users.map((u) => (u.id === updatedUser.id ? updatedUser : u)),
      })
    }
  }

  const handleUserDelete = (userId: string) => {
    if (data) {
      setData({
        ...data,
        users: data.users.filter((u) => u.id !== userId),
        summary: {
          ...data.summary,
          total_users: data.summary.total_users - 1,
        },
      })
    }
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
                  currentUserId={user?.id}
                  isExpanded={expandedUsers.has(adminUser.id)}
                  onToggle={() => toggleUserExpand(adminUser.id)}
                  onUpdate={handleUserUpdate}
                  onDelete={handleUserDelete}
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
  currentUserId,
  isExpanded,
  onToggle,
  onUpdate,
  onDelete,
}: {
  user: AdminUser
  currentUserId?: string
  isExpanded: boolean
  onToggle: () => void
  onUpdate: (user: AdminUser) => void
  onDelete: (userId: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Edit form state
  const [firstName, setFirstName] = useState(user.first_name || '')
  const [lastName, setLastName] = useState(user.last_name || '')
  const [isStaff, setIsStaff] = useState(user.is_staff)
  const [isActive, setIsActive] = useState(user.is_active)

  const isSelf = currentUserId === user.id

  const handleSave = async () => {
    setIsSaving(true)
    setEditError(null)
    try {
      const updated = await adminApi.updateUser(user.id, {
        first_name: firstName,
        last_name: lastName,
        is_staff: isStaff,
        is_active: isActive,
      })
      onUpdate(updated)
      setIsEditing(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setFirstName(user.first_name || '')
    setLastName(user.last_name || '')
    setIsStaff(user.is_staff)
    setIsActive(user.is_active)
    setIsEditing(false)
    setEditError(null)
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await adminApi.deleteUser(user.id)
      onDelete(user.id)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to delete user')
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <Card className={!user.is_active ? 'opacity-60' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-4 cursor-pointer flex-1"
            onClick={onToggle}
          >
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
                {!user.is_active && (
                  <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded">
                    Deactivated
                  </span>
                )}
                {!user.email_verified && (
                  <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded">
                    Unverified
                  </span>
                )}
                {isSelf && (
                  <span className="text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded">
                    You
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

          {/* Stats and Actions */}
          <div className="flex items-center gap-4">
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

            {/* Action buttons */}
            <div className="flex items-center gap-2 ml-4">
              {!isEditing && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsEditing(true)
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  {!isSelf && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowDeleteConfirm(true)
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <CardContent className="pt-0 pb-4">
          <div className="flex items-center gap-4 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-destructive">Delete this user?</p>
              <p className="text-sm text-muted-foreground">
                This will permanently delete {user.email} and all their projects, simulations, and data.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </CardContent>
      )}

      {/* Edit form */}
      {isEditing && (
        <CardContent className="pt-0 pb-4">
          <div className="p-4 bg-secondary/30 rounded-lg border">
            <h4 className="font-medium mb-4">Edit User</h4>

            {editError && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                {editError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm font-medium mb-1 block">First Name</label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Last Name</label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="flex items-center gap-8 mb-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={isStaff}
                  onCheckedChange={setIsStaff}
                  disabled={isSelf}
                />
                <label className="text-sm">
                  Admin access
                  {isSelf && <span className="text-muted-foreground ml-2">(cannot change own)</span>}
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={isSelf}
                />
                <label className="text-sm">
                  Active account
                  {isSelf && <span className="text-muted-foreground ml-2">(cannot change own)</span>}
                </label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      )}

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
