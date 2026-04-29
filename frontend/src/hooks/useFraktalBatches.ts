'use client'

import { useQuery } from '@tanstack/react-query'
import { fraktalApi } from '@/lib/api'

export function useFraktalBatches(projectId: string) {
  return useQuery({
    queryKey: ['fraktal-batches', projectId],
    queryFn: () => fraktalApi.listBatches(projectId),
    enabled: !!projectId,
  })
}
