import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { PendingImage } from '@/types/entities'

interface UseEntityImagesOptions<TEntity extends { images: string }, TImage extends { id: string }> {
  campaignId: string
  entityId: string
  /** URL segment for the entity kind — "npcs" | "locations" | "factions" | "artefacts". */
  kind: string
  /** The entity's current parsed image list, used to compute the optimistic
   *  patch after a delete (the API only returns 204, not the updated list). */
  images: TImage[]
  onUpdated: (patch: Partial<TEntity>) => void
}

/**
 * The upload/delete/generate/confirm image mutations, identical across NPC,
 * Location, Faction and Artefact editors — see docs/code-audit-2026-09-03.md.
 * Location's per-image metadata editing (label/type) has no equivalent on
 * the other three kinds, so it stays local to LocationEditorModal.
 */
export function useEntityImages<TEntity extends { images: string }, TImage extends { id: string }>({
  campaignId, entityId, kind, images, onUpdated,
}: UseEntityImagesOptions<TEntity, TImage>) {
  const base = `/campaigns/${campaignId}/${kind}/${entityId}`

  const upload = useMutation({
    mutationFn: ({ file, extra }: { file: File; extra?: Record<string, string> }) => {
      const form = new FormData()
      form.append('file', file)
      if (extra) for (const [k, v] of Object.entries(extra)) form.append(k, v)
      return api.upload<TEntity>(`${base}/images`, form)
    },
    onSuccess: onUpdated,
  })

  const deleteImage = useMutation({
    mutationFn: (imageId: string) => api.delete(`${base}/images/${imageId}`),
    onSuccess: (_, imageId) => {
      onUpdated({ images: JSON.stringify(images.filter(i => i.id !== imageId)) } as Partial<TEntity>)
    },
  })

  const generateImages = useMutation({
    mutationFn: () => api.post<PendingImage[]>(`${base}/llm/generate-images`, {}),
  })

  const confirmImages = useMutation({
    mutationFn: (selected: string[]) => api.post<TEntity>(`${base}/llm/confirm-images`, { selected }),
    onSuccess: onUpdated,
  })

  return { upload, deleteImage, generateImages, confirmImages }
}
