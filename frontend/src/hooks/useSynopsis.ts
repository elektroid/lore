import { useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { parseSynopsis, serializeSynopsis, type Synopsis, type SynopsisData } from '@/types/synopsis'

export function useSynopsis(scenarioId: string) {
  const queryClient = useQueryClient()
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useQuery({
    queryKey: ['synopsis', scenarioId],
    queryFn: () => api.get<Synopsis>(`/scenarios/${scenarioId}/synopsis`),
  })

  const mutation = useMutation({
    mutationFn: (data: SynopsisData & { overview_cache?: string }) => {
      const { overview_cache, ...content } = data
      return api.put<Synopsis>(`/scenarios/${scenarioId}/synopsis`, {
        ...serializeSynopsis(content),
        overview_cache: overview_cache ?? query.data?.overview_cache ?? '',
      })
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['synopsis', scenarioId], updated)
    },
  })

  const mutateRef = useRef(mutation.mutate)
  mutateRef.current = mutation.mutate

  const save = useCallback(
    (data: SynopsisData, immediate = false) => {
      if (pendingRef.current) clearTimeout(pendingRef.current)
      if (immediate) {
        mutateRef.current(data)
      } else {
        pendingRef.current = setTimeout(() => mutateRef.current(data), 1500)
      }
    },
    [],
  )

  const parsed = query.data ? parseSynopsis(query.data) : null

  return { query, parsed, save, isSaving: mutation.isPending }
}
