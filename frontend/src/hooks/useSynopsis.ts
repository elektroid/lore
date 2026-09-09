import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { registerDirtyCheck, registerPendingWrite } from '@/lib/pendingWrites'
import { parseSynopsis, serializeSynopsis, type Synopsis, type SynopsisData } from '@/types/synopsis'

export function useSynopsis(scenarioId: string) {
  const queryClient = useQueryClient()
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The draft the timer is waiting on, kept out of the timer's closure so
  // `flush` can send it from anywhere — an unmount, or the document unloading.
  const draftRef = useRef<SynopsisData | null>(null)

  const query = useQuery({
    queryKey: ['synopsis', scenarioId],
    queryFn: () => api.get<Synopsis>(`/scenarios/${scenarioId}/synopsis`),
  })

  const mutation = useMutation({
    mutationFn: (data: SynopsisData) =>
      api.put<Synopsis>(`/scenarios/${scenarioId}/synopsis`, serializeSynopsis(data)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['synopsis', scenarioId], updated)
    },
  })

  const mutateRef = useRef(mutation.mutate)
  useEffect(() => { mutateRef.current = mutation.mutate }, [mutation.mutate])

  /** Send the pending draft now, if any. */
  const flush = useCallback(() => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current)
      pendingRef.current = null
    }
    const draft = draftRef.current
    draftRef.current = null
    if (draft) mutateRef.current(draft)
  }, [])

  const save = useCallback(
    (data: SynopsisData, immediate = false) => {
      draftRef.current = data
      if (immediate) {
        flush()
        return
      }
      if (pendingRef.current) clearTimeout(pendingRef.current)
      pendingRef.current = setTimeout(flush, 1500)
    },
    [flush],
  )

  // Leaving the page must not cost the last 1.5 s of typing. The unmount
  // cleanup covers client-side navigation; the registry covers the cases React
  // never sees — a reload, the tab closing, an `<a href>` to an in-app route.
  useEffect(() => () => flush(), [flush])
  useEffect(() => registerPendingWrite(flush), [flush])
  useEffect(() => registerDirtyCheck(() => draftRef.current !== null), [])

  const parsed = query.data ? parseSynopsis(query.data) : null

  return { query, parsed, save, flush, isSaving: mutation.isPending }
}
