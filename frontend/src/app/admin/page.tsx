'use client'

/**
 * Admin users screen, on the design-system kit (issue #183).
 *
 * `/admin` is not chromeless (`isChromeless` is `/` and `/auth/*` only), so
 * the shell draws the frame and the gutter here: this file mounts no `Header`
 * and no layout box of its own, which used to pad the screen twice and stack a
 * second landmark inside the shell's.
 *
 * There is no table of accounts. An account carries an identity, a set of
 * flags, two counts, four controls and an expandable body, and `DataTable` has
 * no row-expansion: forcing one in would have put a button inside every first
 * cell and changed how the list behaves. What *is* tabular sits inside the
 * expanded account — one row per project, with the two counts a reader
 * compares down the column — and that is `DataTable`, with a caption naming
 * the account the rows belong to.
 *
 * What did not move: the staff guard and the redirect target, the single
 * `adminApi.getDashboard()` read behind Refresh, the PATCH payload and the
 * DELETE call, every message, and the rule that you cannot demote, deactivate
 * or delete the account you are signed in with.
 *
 * The account flags keep their words and lose their hue. The old pills picked
 * purple and blue straight out of Tailwind's palette, which is not this
 * system's vocabulary; only the brand, warning and danger families carry
 * meaning here, so "AI access" and "You" are neutral chips that lean on their
 * text and the `Bot` icon instead of on a colour the kit cannot vouch for.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { adminApi, AdminDashboardData, AdminUser } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Callout } from '@/components/kit/Callout'
import { DataTable, type Column } from '@/components/kit/DataTable'
import { EmptyState } from '@/components/kit/EmptyState'
import { MetricCard } from '@/components/kit/MetricCard'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Bot,
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="ADMIN"
        title={
          <>
            <Shield className="mr-2 inline h-7 w-7 align-[-2px]" aria-hidden="true" />
            Admin Dashboard
          </>
        }
        description="Overview of all users and projects"
        actions={
          <Button onClick={fetchAdminData} variant="outline">
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <LoadingScreen message="Loading admin data..." />
      ) : error ? (
        // A read that failed is not an instance with no users: saying so
        // leaves the accounts on the screen and blames the request.
        <Callout tone="danger" title={error} />
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* `digits={0}`: these are counts. The default three decimals turn
                2 projects into "2.000". */}
            <MetricCard
              kind="exact"
              label="Total Users"
              value={data.summary.total_users}
              digits={0}
              tone="teal"
            />
            <MetricCard
              kind="exact"
              label="Total Projects"
              value={data.summary.total_projects}
              digits={0}
              tone="violet"
            />
            <MetricCard
              kind="exact"
              label="Total Simulations"
              value={data.summary.total_simulations}
              digits={0}
              tone="gold"
            />
          </div>

          <Panel
            title="All Users"
            hint="Every account on this instance, with the projects and simulations it owns. Expand one to see what it holds."
          >
            {data.users.length === 0 ? (
              <EmptyState
                icon={Users}
                headingLevel={3}
                title="No users yet"
                description="Accounts appear here as soon as someone registers."
              />
            ) : (
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
            )}
          </Panel>
        </>
      ) : null}
    </div>
  )
}

/**
 * The account flags, as chips that always carry the word.
 *
 * `StatusChip` is the kit's pill, but its union is `SimulationStatus` — a
 * job's state. An account is not running or queued, so the pills are built
 * here from the same recipe (rounded, tracked, uppercase, bordered) over the
 * kit's tokens rather than borrowing a state the product does not have.
 */
type PillTone = 'admin' | 'ai' | 'deactivated' | 'unverified' | 'self'

const PILLS: Record<PillTone, string> = {
  admin: 'border-brand bg-brand-soft text-brand-strong',
  ai: 'border-line-strong bg-surface-soft text-ink',
  deactivated: 'border-danger bg-danger-soft text-danger',
  unverified: 'border-warning bg-warning-soft text-warning',
  self: 'border-line-strong text-ink-muted',
}

function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[10px] font-extrabold uppercase tracking-[0.06em]',
        PILLS[tone],
      )}
    >
      {children}
    </span>
  )
}

type AdminProject = AdminUser['projects'][number]

/** One row per project: counted, and reachable by name. */
const PROJECT_COLUMNS: Column<AdminProject>[] = [
  {
    key: 'name',
    header: 'Project',
    render: (project) => (
      <Link href={`/projects/${project.id}`} className="text-ink hover:text-brand-strong">
        <span className="font-medium">{project.name}</span>
        {project.description && (
          <span className="mt-0.5 block line-clamp-1 text-[11px] text-ink-muted">
            {project.description}
          </span>
        )}
      </Link>
    ),
  },
  {
    key: 'simulations',
    header: 'Simulations',
    numeric: true,
    digits: 0,
    value: (project) => project.simulation_count,
  },
  {
    key: 'studies',
    header: 'Studies',
    numeric: true,
    digits: 0,
    value: (project) => project.study_count,
  },
  {
    key: 'created',
    header: 'Created',
    render: (project) => new Date(project.created_at).toLocaleDateString(),
  },
]

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
  // A refused delete is its own error. It used to be written into `editError`,
  // which only the edit form renders — so a destructive action that failed said
  // nothing at all (#265).
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Edit form state
  const [firstName, setFirstName] = useState(user.first_name || '')
  const [lastName, setLastName] = useState(user.last_name || '')
  const [isStaff, setIsStaff] = useState(user.is_staff)
  const [isActive, setIsActive] = useState(user.is_active)
  const [hasAIAccess, setHasAIAccess] = useState(user.has_ai_access)

  const isSelf = currentUserId === user.id
  const displayName = user.full_name || user.email

  const handleSave = async () => {
    setIsSaving(true)
    setEditError(null)
    try {
      const updated = await adminApi.updateUser(user.id, {
        first_name: firstName,
        last_name: lastName,
        is_staff: isStaff,
        is_active: isActive,
        has_ai_access: hasAIAccess,
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
    setHasAIAccess(user.has_ai_access)
    setIsEditing(false)
    setEditError(null)
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await adminApi.deleteUser(user.id)
      onDelete(user.id)
    } catch (err) {
      // The row stays: removing it locally would claim a deletion that did not
      // happen. The message is rendered next to the account (#265).
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete user')
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    // A deactivated account stays legible while reading as diminished. The
    // state is also spelled out in the "Deactivated" chip, so the opacity is
    // decoration and not the only carrier.
    <article
      className={cn(
        'rounded-lg border border-line bg-surface p-[17px_18px]',
        !user.is_active && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/*
            The chevron names the account it opens, not "toggle": nine
            identical "toggle" buttons are indistinguishable out of context.
          */}
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 -mt-1 h-8 w-8 shrink-0"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Hide' : 'Show'} projects for ${displayName}`}
            onClick={(e) => {
              // The identity block below is clickable too; without this the
              // click would reach both handlers and toggle twice.
              e.stopPropagation()
              onToggle()
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-5 w-5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            )}
          </Button>

          <div className="min-w-0 cursor-pointer" onClick={onToggle}>
            <h3 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.015em] text-ink">
              {displayName}
              {user.is_staff && <Pill tone="admin">Admin</Pill>}
              {user.has_ai_access && (
                <Pill tone="ai">
                  <Bot className="h-3 w-3" aria-hidden="true" />
                  AI
                </Pill>
              )}
              {!user.is_active && <Pill tone="deactivated">Deactivated</Pill>}
              {!user.email_verified && <Pill tone="unverified">Unverified</Pill>}
              {isSelf && <Pill tone="self">You</Pill>}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" aria-hidden="true" />
                {user.email}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" aria-hidden="true" />
                Joined {new Date(user.created_at).toLocaleDateString()}
              </span>
              {user.oauth_provider && <Pill tone="self">{user.oauth_provider}</Pill>}
            </div>
          </div>
        </div>

        {/* Stats and actions */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4 text-[12px] text-ink-muted">
            <span className="inline-flex items-baseline gap-1">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              <Num value={user.project_count} digits={0} size="sm" />
              <span>projects</span>
            </span>
            <span className="inline-flex items-baseline gap-1">
              <Atom className="h-4 w-4" aria-hidden="true" />
              <Num value={user.simulation_count} digits={0} size="sm" />
              <span>sims</span>
            </span>
          </div>

          {!isEditing && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={`Edit ${displayName}`}
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-4 w-4" aria-hidden="true" />
              </Button>
              {/* Deleting yourself would take the account doing the deleting,
                  so the control is absent rather than disabled. */}
              {!isSelf && (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Delete ${displayName}`}
                  onClick={() => {
                    setDeleteError(null)
                    setShowDeleteConfirm(true)
                  }}
                >
                  <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <Callout
          tone="danger"
          title="Delete this user?"
          className="mt-4"
          action={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeleteError(null)
                  setShowDeleteConfirm(false)
                }}
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
          }
        >
          This will permanently delete {user.email} and all their projects, simulations, and
          data.
        </Callout>
      )}

      {/*
        A refused delete. It sits in the account's own card because that is where
        the reader pressed the button: the confirmation strip closes on failure, so
        without this the screen looked exactly like a successful delete (#265).
      */}
      {deleteError && (
        <Callout tone="danger" title="Could not delete this user" className="mt-4">
          {deleteError}
        </Callout>
      )}

      {/* Edit form */}
      {isEditing && (
        <div className="mt-4 rounded-lg border border-line bg-surface-soft p-4">
          <h4 className="m-0 mb-4 text-[13px] font-semibold text-ink">Edit User</h4>

          {editError && <Callout tone="danger" title={editError} className="mb-4" />}

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`first-name-${user.id}`}>First Name</Label>
              <Input
                id={`first-name-${user.id}`}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`last-name-${user.id}`}>Last Name</Label>
              <Input
                id={`last-name-${user.id}`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              {/* The visible text is a paragraph, not a `<label for>`: a
                  `Switch` is a button, and only the button itself can carry
                  the name a screen reader announces. */}
              <Switch
                checked={isStaff}
                onCheckedChange={setIsStaff}
                disabled={isSelf}
                aria-label="Admin access"
              />
              <span className="text-[12px] text-ink">
                Admin access
                {isSelf && (
                  <span className="ml-2 text-ink-muted">(cannot change own)</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={isSelf}
                aria-label="Active account"
              />
              <span className="text-[12px] text-ink">
                Active account
                {isSelf && (
                  <span className="ml-2 text-ink-muted">(cannot change own)</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={hasAIAccess}
                onCheckedChange={setHasAIAccess}
                disabled={isStaff}
                aria-label="AI Assistant access"
              />
              <span className="inline-flex items-center gap-1 text-[12px] text-ink">
                <Bot className="h-4 w-4" aria-hidden="true" />
                AI Assistant access
                {isStaff && (
                  <span className="ml-2 text-ink-muted">
                    (admins always have access)
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" aria-hidden="true" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving}>
              <X className="mr-2 h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="mt-4 border-t border-line pt-4">
          <h4 className="m-0 mb-3 text-[13px] font-semibold text-ink">Projects</h4>
          {user.projects.length > 0 ? (
            <DataTable
              columns={PROJECT_COLUMNS}
              rows={user.projects}
              rowKey={(project) => project.id}
              caption={`Projects owned by ${displayName}`}
              emptyMessage="No projects yet"
            />
          ) : (
            <p className="hint">No projects yet</p>
          )}
        </div>
      )}
    </article>
  )
}
