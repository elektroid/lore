import { useEffect, useRef, useState } from 'react'
import { Sparkles, Trash2, X, Images } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { CampaignNPC, NPCImage, PendingImage } from '@/types/entities'
import { api } from '@/api/client'
import ImageCandidatePicker from '@/components/ImageCandidatePicker'

interface Props {
  npcId: string
  campaignId: string
  open: boolean
  onClose: () => void
}

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

// ── LLM develop review dialog ─────────────────────────────────────────────────

type NPCFields = { role: string; description: string; motivation: string; quote: string }

function DevelopReviewDialog({
  current, suggestion, open, onApply, onClose,
}: {
  current: NPCFields
  suggestion: NPCFields
  open: boolean
  onApply: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proposition du LLM — relisez avant d'appliquer</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {(['role', 'description', 'motivation', 'quote'] as const).map(field => {
            const labels: Record<string, string> = { role: 'Rôle', description: 'Description', motivation: 'Motivation', quote: 'Réplique type' }
            return (
              <div key={field} className="col-span-2 grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  {field === 'role' && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actuel</p>}
                  <p className="text-xs text-muted-foreground">{labels[field]}</p>
                  <p className="rounded border bg-muted/50 px-3 py-2 text-xs whitespace-pre-wrap select-all min-h-[40px]">
                    {current[field] || <span className="italic text-muted-foreground">(vide)</span>}
                  </p>
                </div>
                <div className="space-y-1">
                  {field === 'role' && <p className="text-xs font-semibold text-primary uppercase tracking-wide">Nouveau</p>}
                  <p className="text-xs text-muted-foreground">{labels[field]}</p>
                  <p className="rounded border border-primary/30 bg-primary/5 px-3 py-2 text-xs whitespace-pre-wrap select-all min-h-[40px]">
                    {suggestion[field]}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={onApply}>Appliquer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef<Partial<{ name: string; role: string; description: string; motivation: string; quote: string }>>({})

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
      setLocal({ name: npc.name, role: npc.role, description: npc.description, motivation: npc.motivation, quote: npc.quote })
      draftRef.current = {}
    }
  }, [npc])

  const [llmSuggestion, setLlmSuggestion] = useState<NPCFields | null>(null)

  const save = useMutation({
    mutationFn: (patch: Partial<typeof local>) =>
      api.put<CampaignNPC>(`/campaigns/${campaignId}/npcs/${npcId}`, {
        name: local.name, role: local.role, description: local.description,
        motivation: local.motivation, quote: local.quote, ...patch,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['npc', npcId], updated)
      qc.invalidateQueries({ queryKey: ['campaign-npcs', campaignId] })
      qc.invalidateQueries({ queryKey: ['synopsis-npcs'] })
    },
  })

  const develop = useMutation({
    mutationFn: () => api.post<NPCFields>(`/campaigns/${campaignId}/npcs/${npcId}/llm/develop`, {}),
    onSuccess: (data) => setLlmSuggestion(data),
  })

  function scheduleUpdate(patch: Partial<typeof draftRef.current>) {
    draftRef.current = { ...draftRef.current, ...patch }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      save.mutate(draftRef.current)
      draftRef.current = {}
    }, 800)
  }

  function handle(field: keyof typeof local, value: string) {
    setLocal(l => ({ ...l, [field]: value }))
    scheduleUpdate({ [field]: value })
  }

  function applyLlmSuggestion() {
    if (!llmSuggestion) return
    const patch = { role: llmSuggestion.role, description: llmSuggestion.description, motivation: llmSuggestion.motivation, quote: llmSuggestion.quote }
    setLocal(l => ({ ...l, ...patch }))
    save.mutate(patch)
    setLlmSuggestion(null)
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
    <>
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
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={develop.isPending} onClick={() => develop.mutate()}>
                    <Sparkles className="h-3 w-3 mr-1" />
                    {develop.isPending ? 'Génération…' : 'Développer avec le LLM'}
                  </Button>
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

              <ImageGrid images={images} npcId={npcId} campaignId={campaignId} onUpdated={handleNPCUpdated} />

              {save.isPending && <p className="text-xs text-muted-foreground text-right">Sauvegarde…</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {llmSuggestion && npc && (
        <DevelopReviewDialog
          current={{ role: npc.role, description: npc.description, motivation: npc.motivation, quote: npc.quote }}
          suggestion={llmSuggestion}
          open={!!llmSuggestion}
          onApply={applyLlmSuggestion}
          onClose={() => setLlmSuggestion(null)}
        />
      )}
    </>
  )
}
