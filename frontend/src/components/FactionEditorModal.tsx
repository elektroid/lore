import { useEffect, useRef, useState } from 'react'
import { Trash2, X, Images } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CampaignFaction, FactionImage, PendingImage } from '@/types/entities'
import { api } from '@/api/client'
import ImageCandidatePicker from '@/components/ImageCandidatePicker'

function AutoTextarea({ value, onChange, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref} rows={3} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    />
  )
}

function ImageGrid({
  images, factionId, campaignId, onUpdated,
}: {
  images: FactionImage[]
  factionId: string
  campaignId: string
  onUpdated: (f: CampaignFaction) => void
}) {
  const [lightbox, setLightbox] = useState<FactionImage | null>(null)
  const [candidates, setCandidates] = useState<PendingImage[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload<CampaignFaction>(`/campaigns/${campaignId}/factions/${factionId}/images`, form)
    },
    onSuccess: onUpdated,
  })

  const deleteImg = useMutation({
    mutationFn: (imageId: string) =>
      api.delete(`/campaigns/${campaignId}/factions/${factionId}/images/${imageId}`),
    onSuccess: (_, imageId) => {
      onUpdated({ ...({} as CampaignFaction), images: JSON.stringify(images.filter(i => i.id !== imageId)) })
    },
  })

  const generateImages = useMutation({
    mutationFn: () => api.post<PendingImage[]>(`/campaigns/${campaignId}/factions/${factionId}/llm/generate-images`, {}),
    onSuccess: (data) => { setCandidates(data); setPickerOpen(true) },
  })

  const confirmImages = useMutation({
    mutationFn: (selected: string[]) =>
      api.post<CampaignFaction>(`/campaigns/${campaignId}/factions/${factionId}/llm/confirm-images`, { selected }),
    onSuccess: (updated) => { setPickerOpen(false); setCandidates([]); onUpdated(updated) },
  })

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
        onChange={e => { Array.from(e.target.files ?? []).forEach(f => upload.mutate(f)); e.target.value = '' }}
      />
      <div
        onDrop={e => { e.preventDefault(); Array.from(e.dataTransfer.files).forEach(f => upload.mutate(f)) }}
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
                src={img.url} alt={img.label || 'illustration'}
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
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setLightbox(null)}>
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

interface Props {
  factionId: string
  campaignId: string
  open: boolean
  onClose: () => void
}

export default function FactionEditorModal({ factionId, campaignId, open, onClose }: Props) {
  const qc = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef<Partial<{ name: string; type: string; description: string; motivation: string }>>({})

  const { data: faction, isLoading } = useQuery({
    queryKey: ['faction', factionId],
    queryFn: () => api.get<CampaignFaction>(`/campaigns/${campaignId}/factions/${factionId}`),
    enabled: open && !!factionId,
  })

  const [local, setLocal] = useState({ name: '', type: '', description: '', motivation: '' })
  const prevIdRef = useRef('')

  useEffect(() => {
    if (faction && faction.id !== prevIdRef.current) {
      prevIdRef.current = faction.id
      setLocal({ name: faction.name, type: faction.type, description: faction.description, motivation: faction.motivation })
      draftRef.current = {}
    }
  }, [faction])

  const save = useMutation({
    mutationFn: (patch: Partial<typeof local>) => {
      const current = qc.getQueryData<CampaignFaction>(['faction', factionId])
      return api.put<CampaignFaction>(`/campaigns/${campaignId}/factions/${factionId}`, {
        name: local.name, type: local.type, description: local.description,
        motivation: local.motivation, images: current?.images ?? '[]', ...patch,
      })
    },
    onSuccess: (updated) => {
      qc.setQueryData(['faction', factionId], updated)
      qc.invalidateQueries({ queryKey: ['campaign-factions', campaignId] })
    },
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

  function handleFactionUpdated(updated: CampaignFaction) {
    qc.setQueryData(['faction', factionId], updated)
    qc.invalidateQueries({ queryKey: ['campaign-factions', campaignId] })
  }

  const images: FactionImage[] = (() => {
    try { return JSON.parse(faction?.images ?? '[]') } catch { return [] }
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
                placeholder="Nom de la faction"
              />
            )}
          </DialogTitle>
        </DialogHeader>
        {!isLoading && faction && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</p>
              <Input value={local.type} onChange={e => handle('type', e.target.value)} placeholder="Corporation, gang, culte…" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
              <AutoTextarea value={local.description} onChange={v => handle('description', v)} placeholder="Présentation, structure, histoire…" className="min-h-[100px]" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Motivation</p>
              <Input value={local.motivation} onChange={e => handle('motivation', e.target.value)} placeholder="Ce qui fait agir la faction…" className="h-8 text-sm" />
            </div>
            <ImageGrid images={images} factionId={factionId} campaignId={campaignId} onUpdated={handleFactionUpdated} />
            {save.isPending && <p className="text-xs text-muted-foreground text-right">Sauvegarde…</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
