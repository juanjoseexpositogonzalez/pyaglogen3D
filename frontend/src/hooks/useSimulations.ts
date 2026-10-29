'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { simulationsApi } from '@/lib/api'
import type { CreateSimulationInput } from '@/lib/types'

export function useSimulations(projectId: string, params?: Record<string, string>) {
  return useQuery({
    queryKey: ['simulations', projectId, params],
    queryFn: () => simulationsApi.list(projectId, params),
    enabled: !!projectId,
  })
}

export function useSimulation(projectId: string, id: string) {
  return useQuery({
    queryKey: ['simulations', projectId, id],
    queryFn: () => simulationsApi.get(projectId, id),
    enabled: !!projectId && !!id,
    // Poll while simulation is running
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'queued' || status === 'running') {
        return 2000 // Poll every 2 seconds
      }
      return false
    },
  })
}

export function useCreateSimulation(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateSimulationInput) =>
      simulationsApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useDeleteSimulation(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => simulationsApi.delete(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useSimulationGeometry(simulationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['geometry', simulationId],
    queryFn: () => simulationsApi.getGeometry(simulationId),
    enabled: enabled && !!simulationId,
    staleTime: Infinity, // Geometry data doesn't change
  })
}

export function useNeighborGraph(projectId: string, simulationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['neighbor-graph', projectId, simulationId],
    queryFn: () => simulationsApi.getNeighborGraph(projectId, simulationId),
    enabled: enabled && !!projectId && !!simulationId,
    staleTime: Infinity, // Graph data doesn't change for a completed simulation
  })
}
