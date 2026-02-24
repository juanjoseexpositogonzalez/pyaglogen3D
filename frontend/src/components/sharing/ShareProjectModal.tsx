'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sharingApi, ApiError } from '@/lib/api'
import type { SharePermission, ProjectShare, ShareInvitation } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, X, UserPlus, Mail, Trash2 } from 'lucide-react'

interface ShareProjectModalProps {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const permissionLabels: Record<SharePermission, string> = {
  view: 'View Only',
  edit: 'Can Edit',
  admin: 'Admin',
}

export function ShareProjectModal({
  projectId,
  projectName,
  open,
  onOpenChange,
}: ShareProjectModalProps) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState<SharePermission>('view')
  const [error, setError] = useState<string | null>(null)

  // Fetch sharing data
  const { data: sharingData, isLoading } = useQuery({
    queryKey: ['project-sharing', projectId],
    queryFn: () => sharingApi.get(projectId),
    enabled: open,
  })

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: ({ email, permission }: { email: string; permission: SharePermission }) =>
      sharingApi.invite(projectId, email, permission),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-sharing', projectId] })
      setEmail('')
      setError(null)
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Failed to send invitation')
      }
    },
  })

  // Remove mutation
  const removeMutation = useMutation({
    mutationFn: (shareId: string) => sharingApi.remove(projectId, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-sharing', projectId] })
    },
  })

  // Update permission mutation
  const updateMutation = useMutation({
    mutationFn: ({ shareId, permission }: { shareId: string; permission: SharePermission }) =>
      sharingApi.updatePermission(projectId, shareId, permission),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-sharing', projectId] })
    },
  })

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    inviteMutation.mutate({ email, permission })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Share Project</DialogTitle>
          <DialogDescription className="text-gray-400">
            Invite collaborators to &quot;{projectName}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Invite form */}
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="invite-email" className="sr-only">
                  Email
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-700 border-gray-600 text-white"
                />
              </div>
              <Select
                value={permission}
                onValueChange={(v) => setPermission(v as SharePermission)}
              >
                <SelectTrigger className="w-[130px] bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="view">View Only</SelectItem>
                  <SelectItem value="edit">Can Edit</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="submit"
                disabled={!email || inviteMutation.isPending}
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
              </Button>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>

          {/* Collaborators list */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-300">Collaborators</h4>
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="space-y-2">
                {sharingData?.collaborators.map((share) => (
                  <CollaboratorRow
                    key={share.id}
                    share={share}
                    onPermissionChange={(permission) =>
                      updateMutation.mutate({ shareId: share.id, permission })
                    }
                    onRemove={() => removeMutation.mutate(share.id)}
                    isUpdating={updateMutation.isPending}
                    isRemoving={removeMutation.isPending}
                  />
                ))}
                {sharingData?.pending_invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    onRemove={() => removeMutation.mutate(invitation.id)}
                    isRemoving={removeMutation.isPending}
                  />
                ))}
                {(!sharingData?.collaborators.length &&
                  !sharingData?.pending_invitations.length) && (
                  <p className="text-sm text-gray-400 py-2">
                    No collaborators yet. Invite someone to get started.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface CollaboratorRowProps {
  share: ProjectShare
  onPermissionChange: (permission: SharePermission) => void
  onRemove: () => void
  isUpdating: boolean
  isRemoving: boolean
}

function CollaboratorRow({
  share,
  onPermissionChange,
  onRemove,
  isUpdating,
  isRemoving,
}: CollaboratorRowProps) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-gray-700/50 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
          <span className="text-sm font-medium">
            {share.user.first_name?.[0] || share.user.email[0].toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-sm font-medium text-white">
            {share.user.first_name && share.user.last_name
              ? `${share.user.first_name} ${share.user.last_name}`
              : share.user.email}
          </p>
          {share.user.first_name && (
            <p className="text-xs text-gray-400">{share.user.email}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={share.permission}
          onValueChange={(v) => onPermissionChange(v as SharePermission)}
          disabled={isUpdating}
        >
          <SelectTrigger className="w-[110px] h-8 bg-gray-700 border-gray-600 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-700 border-gray-600">
            <SelectItem value="view">View Only</SelectItem>
            <SelectItem value="edit">Can Edit</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-red-400"
          onClick={onRemove}
          disabled={isRemoving}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

interface InvitationRowProps {
  invitation: ShareInvitation
  onRemove: () => void
  isRemoving: boolean
}

function InvitationRow({ invitation, onRemove, isRemoving }: InvitationRowProps) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-gray-700/50 rounded-lg border border-dashed border-gray-600">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-600/50 flex items-center justify-center">
          <Mail className="h-4 w-4 text-gray-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-300">{invitation.email}</p>
          <p className="text-xs text-gray-500">
            Invitation pending • {permissionLabels[invitation.permission]}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-gray-400 hover:text-red-400"
        onClick={onRemove}
        disabled={isRemoving}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
