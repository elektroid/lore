import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Synopsis, Scene } from '@/types/synopsis'

export function useSynopsisLLM(scenarioId: string) {
  const queryClient = useQueryClient()

  function onSynopsisSuccess(data: Synopsis) {
    queryClient.setQueryData(['synopsis', scenarioId], data)
    queryClient.invalidateQueries({ queryKey: ['snapshots', scenarioId] })
  }

  const completeHook = useMutation({
    mutationFn: () => api.post<Synopsis>(`/scenarios/${scenarioId}/synopsis/llm/complete-hook`, {}),
    onSuccess: onSynopsisSuccess,
  })

  const suggestNPCs = useMutation({
    mutationFn: () => api.post<unknown>(`/scenarios/${scenarioId}/synopsis/llm/suggest-npcs`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['synopsis-npcs', scenarioId] })
    },
  })

  const suggestScene = useMutation({
    mutationFn: () => api.post<Scene>(`/scenarios/${scenarioId}/synopsis/llm/suggest-scene`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenes', scenarioId] })
    },
  })

  const generateOverview = useMutation({
    mutationFn: () => api.post<Synopsis>(`/scenarios/${scenarioId}/synopsis/llm/generate-overview`, {}),
    onSuccess: onSynopsisSuccess,
  })

  return {
    completeHook,
    suggestNPCs,
    suggestScene,
    generateOverview,
  }
}
