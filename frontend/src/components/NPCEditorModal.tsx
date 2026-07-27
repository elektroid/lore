import { useEffect, useRef, useState } from 'react'
import { Sparkles, Trash2, X, Images } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CampaignNPC, NPCImage, PendingImage } from '@/types/entities'
import { api } from '@/api/client'
import { patchCachedItem, patchCachedListItem } from '@/api/cache'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import ImageCandidatePicker from '@/components/ImageCandidatePicker'
import LLMSuggestionReview, { type SuggestionField } from '@/components/LLMSuggestionReview'

interface Props {
  npcId: string
  campaignId: string
  open: boolean
  onClose: () => void
}

export const NPC_SUGGESTION_FIELDS: SuggestionField[] = [
  { key: 'role', label: 'Rôle' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'motivation', label: 'Motivation' },
  { key: 'quote', label: 'Réplique type', multiline: true },
]

// ── Auto-grow textarea ─────────────────────────────────────────────────────────

function AutoTextarea({ value, onChange, placeholder, className = '', disabled }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; className?: string; disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref} rows={3} value={value} placeholder={placeholder} disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    />
  )
}

// ── Image grid (illustrations only) ──────────────────────────────────────────

function ImageGrid({
  images, npcId, campaignId, onUpdated,
}: {
  images: NPCImage[]
  npcId: string
  campaignId: string
  onUpdated: (npc: CampaignNPC) => void
}) {
  const [lightbox, setLightbox] = useState<NPCImage | null>(null)
  const [candidates, setCandidates] = useState<PendingImage[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload<CampaignNPC>(`/campaigns/${campaignId}/npcs/${npcId}/images`, form)
    },
    onSuccess: onUpdated,
  })

  const deleteImg = useMutation({
    mutationFn: (imageId: string) =>
      api.delete(`/campaigns/${campaignId}/npcs/${npcId}/images/${imageId}`),
    onSuccess: (_, imageId) => {
      onUpdated({ ...({} as CampaignNPC), images: JSON.stringify(images.filter(i => i.id !== imageId)) })
    },
  })

  const generateImages = useMutation({
    mutationFn: () => api.post<PendingImage[]>(`/campaigns/${campaignId}/npcs/${npcId}/llm/generate-images`, {}),
    onSuccess: (data) => { setCandidates(data); setPickerOpen(true) },
  })

  const confirmImages = useMutation({
    mutationFn: (selected: string[]) =>
      api.post<CampaignNPC>(`/campaigns/${campaignId}/npcs/${npcId}/llm/confirm-images`, { selected }),
    onSuccess: (updated) => { setPickerOpen(false); setCandidates([]); onUpdated(updated) },
  })

  function handleFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach(file => upload.mutate(file))
  }

  return (
    <>
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Illustrations</p>
        <div className="flex gap-1">
          <Button
            size="sm" variant="ghost" className="h-7 px-2 text-xs"
            disabled={generateImages.isPending}
            onClick={() => generateImages.mutate()}
          >
            <Images className="h-3 w-3 mr-1" />
            {generateImages.isPending ? 'Génération…' : 'Générer'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => inputRef.current?.click()}>
            Ajouter
          </Button>
        </div>
      </div>
      {generateImages.isError && <p className="text-xs text-destructive">{(generateImages.error as Error).message}</p>}

      <input
        ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />

      <div
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        onDragOver={e => e.preventDefault()}
        className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 text-center text-xs text-muted-foreground hover:border-muted-foreground/40 transition-colors"
      >
        {upload.isPending ? 'Upload en cours…' : 'Glissez des illustrations ici'}
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map(img => (
            <div key={img.id} className="group relative rounded-md overflow-hidden border bg-muted/30">
              <img
                src={img.url}
                alt={img.label || 'illustration'}
                className="w-full h-24 object-cover cursor-pointer"
                onClick={() => setLightbox(img)}
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition-opacity flex justify-end">
                <button onClick={() => deleteImg.mutate(img.id)} className="text-white/70 hover:text-red-400">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightbox.url} alt={lightbox.label} className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
    <ImageCandidatePicker
      candidates={candidates}
      open={pickerOpen}
      onConfirm={selected => confirmImages.mutate(selected)}
      onClose={() => { setPickerOpen(false); setCandidates([]) }}
    />
    </>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export default function NPCEditorModal({ npcId, campaignId, open, onClose }: Props) {
  const qc = useQueryClient()
  const draft = useDebouncedSave<Partial<{ name: string; role: string; description: string; motivation: string; quote: string }>>()

  const { data: npc, isLoading } = useQuery({
    queryKey: ['npc', npcId],
    queryFn: () => api.get<CampaignNPC>(`/campaigns/${campaignId}/npcs/${npcId}`),
    enabled: open && !!npcId,
  })

  const [local, setLocal] = useState({ name: '', role: '', description: '', motivation: '', quote: '' })
  const prevIdRef = useRef('')

  useEffect(() => {
    if (npc && npc.id !== prevIdRef.current) {
      prevIdRef.current = npc.id
      // Anything still pending belongs to the NPC we are leaving — save it.
      draft.flush()
      setLocal({ name: npc.name, role: npc.role, description: npc.description, motivation: npc.motivation, quote: npc.quote })
    }
  }, [npc, draft])

  const [suggestion, setSuggestion] = useState<Record<string, string> | null>(null)

  const save = useMutation({
    // Body built from the cached NPC (kept current by the optimistic patch
    // below), so a draft flushed after the modal moved on still saves against
    // the NPC it was typed into.
    mutationFn: ({ id, patch }: { id: string; patch: Partial<typeof local> }) => {
      const base = qc.getQueryData<CampaignNPC>(['npc', id])
      return api.put<CampaignNPC>(`/campaigns/${campaignId}/npcs/${id}`, {
        name: base?.name ?? local.name,
        role: base?.role ?? local.role,
        description: base?.description ?? local.description,
        motivation: base?.motivation ?? local.motivation,
        quote: base?.quote ?? local.quote,
        ...patch,
      })
    },
    onSuccess: (updated) => {
      qc.setQueryData(['npc', updated.id], updated)
      qc.invalidateQueries({ queryKey: ['campaign-npcs', campaignId] })
      qc.invalidateQueries({ queryKey: ['synopsis-npcs'] })
    },
  })

  // Show the edit in the entity lists while the user types, instead of one
  // debounce later.
  function patchNPC(id: string, patch: Partial<typeof local>) {
    patchCachedItem<CampaignNPC>(qc, ['npc', id], patch)
    patchCachedListItem<CampaignNPC>(qc, ['campaign-npcs', campaignId], id, patch)
  }

  const develop = useMutation({
    mutationFn: () => api.post<Record<string, string>>(`/campaigns/${campaignId}/npcs/${npcId}/llm/develop`, {
      current: local,
    }),
    onSuccess: (data) => setSuggestion(data),
  })

  async function regenerateFields(keys: string[], instruction: string) {
    return api.post<Record<string, string>>(`/campaigns/${campaignId}/npcs/${npcId}/llm/develop`, {
      current: local, fields: keys, instruction,
    })
  }

  function acceptField(key: string, value: string) {
    const id = npcId
    setLocal(l => ({ ...l, [key]: value }))
    patchNPC(id, { [key]: value })
    draft.saveNow({ [key]: value }, patch => save.mutate({ id, patch }))
  }

  function handle(field: keyof typeof local, value: string) {
    const id = npcId
    setLocal(l => ({ ...l, [field]: value }))
    patchNPC(id, { [field]: value })
    draft.schedule({ [field]: value }, patch => save.mutate({ id, patch }))
  }

  function handleNPCUpdated(updated: CampaignNPC) {
    qc.setQueryData(['npc', npcId], updated)
    qc.invalidateQueries({ queryKey: ['campaign-npcs', campaignId] })
    qc.invalidateQueries({ queryKey: ['synopsis-npcs'] })
  }

  const images: NPCImage[] = (() => {
    try { return JSON.parse(npc?.images ?? '[]') } catch { return [] }
  })()

  return (
      <Dialog open={open} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isLoading ? 'Chargement…' : (
                <input
                  value={local.name}
                  onChange={e => handle('name', e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-lg font-semibold placeholder:text-muted-foreground/50"
                  placeholder="Nom du PNJ"
                />
              )}
            </DialogTitle>
          </DialogHeader>

          {!isLoading && npc && (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rôle</p>
                <Input value={local.role} onChange={e => handle('role', e.target.value)} placeholder="Rôle dans l'histoire" className="h-8 text-sm" />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
                  {!suggestion && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={develop.isPending} onClick={() => develop.mutate()}>
                      <Sparkles className="h-3 w-3 mr-1" />
                      {develop.isPending ? 'Génération…' : 'Développer avec le LLM'}
                    </Button>
                  )}
                </div>
                {develop.isError && <p className="text-xs text-destructive">{(develop.error as Error).message}</p>}
                <AutoTextarea value={local.description} onChange={v => handle('description', v)} placeholder="Description physique, psychologie…" className="min-h-[100px]" />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Motivation</p>
                <Input value={local.motivation} onChange={e => handle('motivation', e.target.value)} placeholder="Ce qui le fait agir" className="h-8 text-sm" />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Réplique type</p>
                <AutoTextarea value={local.quote} onChange={v => handle('quote', v)} placeholder="«…»" className="italic" />
              </div>

              {suggestion && (
                <LLMSuggestionReview
                  fields={NPC_SUGGESTION_FIELDS}
                  suggestion={suggestion}
                  onAcceptField={acceptField}
                  onRegenerate={regenerateFields}
                  onDone={() => setSuggestion(null)}
                />
              )}

              <ImageGrid images={images} npcId={npcId} campaignId={campaignId} onUpdated={handleNPCUpdated} />

              {save.isPending && <p className="text-xs text-muted-foreground text-right">Sauvegarde…</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
  )
}
