'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fraktalApi } from '@/lib/api'
import type { CreateFraktalInput } from '@/lib/types'

export function useFraktalAnalyses(projectId: string) {
  return useQuery({
    queryKey: ['fraktal', projectId],
    queryFn: () => fraktalApi.list(projectId),
    enabled: !!projectId,
  })
}

export function useFraktalAnalysis(projectId: string, id: string) {
  return useQuery({
    queryKey: ['fraktal', projectId, id],
    queryFn: () => fraktalApi.get(projectId, id),
    enabled: !!projectId && !!id,
    // Poll while analysis is running
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'queued' || status === 'running') {
        return 2000 // Poll every 2 seconds
      }
      return false
    },
  })
}

export function useCreateFraktalAnalysis(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateFraktalInput) =>
      fraktalApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fraktal', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useDeleteFraktalAnalysis(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => fraktalApi.delete(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fraktal', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useRerunFraktalAnalysis(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => fraktalApi.rerun(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fraktal', projectId] })
    },
  })
}
