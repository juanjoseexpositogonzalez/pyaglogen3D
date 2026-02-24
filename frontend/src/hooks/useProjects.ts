'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import type { CreateProjectInput } from '@/lib/types'

export function useProjects() {
  const { isLoading: authLoading, isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    // Only fetch when auth is ready and user is authenticated
    enabled: !authLoading && isAuthenticated,
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => projectsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateProjectInput) => projectsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
