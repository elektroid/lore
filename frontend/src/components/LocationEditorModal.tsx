import { useEffect, useRef, useState } from 'react'
import { Sparkles, Trash2, Map, ImageIcon, X, Images } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { CampaignLocation, LocationImage, PendingImage } from '@/types/entities'
import { api } from '@/api/client'
import ImageCandidatePicker from '@/components/ImageCandidatePicker'

interface Props {
  locationId: string
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

function DevelopReviewDialog({
  current, suggestion, open, onApply, onClose,
}: {
  current: { description: string; atmosphere: string }
  suggestion: { description: string; atmosphere: string }
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
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actuel</p>
            {current.atmosphere && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Atmosphère</p>
                <p className="rounded border bg-muted/50 px-3 py-2 text-xs select-all">{current.atmosphere}</p>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="rounded border bg-muted/50 px-3 py-2 text-xs whitespace-pre-wrap select-all min-h-[80px]">
                {current.description || <span className="italic text-muted-foreground">(vide)</span>}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">Nouveau</p>
            {suggestion.atmosphere && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Atmosphère</p>
                <p className="rounded border border-primary/30 bg-primary/5 px-3 py-2 text-xs select-all">{suggestion.atmosphere}</p>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="rounded border border-primary/30 bg-primary/5 px-3 py-2 text-xs whitespace-pre-wrap select-all min-h-[80px]">
                {suggestion.description}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={onApply}>Appliquer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Image grid ─────────────────────────────────────────────────────────────────

function ImageGrid({
  images, locationId, campaignId, onUpdated,
}: {
  images: LocationImage[]
  locationId: string
  campaignId: string
  onUpdated: (loc: CampaignLocation) => void
}) {
  const [lightbox, setLightbox] = useState<LocationImage | null>(null)
  const [candidates, setCandidates] = useState<PendingImage[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const generateImages = useMutation({
    mutationFn: () => api.post<PendingImage[]>(`/campaigns/${campaignId}/locations/${locationId}/llm/generate-images`, {}),
    onSuccess: (data) => { setCandidates(data); setPickerOpen(true) },
  })

  const confirmImages = useMutation({
    mutationFn: (selected: string[]) =>
      api.post<CampaignLocation>(`/campaigns/${campaignId}/locations/${locationId}/llm/confirm-images`, { selected }),
    onSuccess: (updated) => { setPickerOpen(false); setCandidates([]); onUpdated(updated) },
  })

  const upload = useMutation({
    mutationFn: ({ file, type }: { file: File; type: string }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('type', type)
      return api.upload<CampaignLocation>(`/campaigns/${campaignId}/locations/${locationId}/images`, form)
    },
    onSuccess: onUpdated,
  })

  const updateMeta = useMutation({
    mutationFn: ({ imageId, label, type }: { imageId: string; label: string; type: string }) =>
      api.put<CampaignLocation>(`/campaigns/${campaignId}/locations/${locationId}/images/${imageId}`, { label, type }),
    onSuccess: onUpdated,
  })

  const deleteImg = useMutation({
    mutationFn: (imageId: string) =>
      api.delete(`/campaigns/${campaignId}/locations/${locationId}/images/${imageId}`),
    onSuccess: (_, imageId) => {
      // optimistically remove
      onUpdated({ ...({} as CampaignLocation), images: JSON.stringify(images.filter(i => i.id !== imageId)) })
    },
  })

  function handleFiles(files: FileList | null, type = 'illustration') {
    if (!files) return
    Array.from(files).forEach(file => upload.mutate({ file, type }))
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  return (
    <>
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Images</p>
        <div className="flex gap-1">
          <Button
            size="sm" variant="ghost" className="h-7 px-2 text-xs"
            disabled={generateImages.isPending}
            onClick={() => generateImages.mutate()}
          >
            <Images className="h-3 w-3 mr-1" />
            {generateImages.isPending ? 'Génération…' : 'Générer'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { if (inputRef.current) { inputRef.current.setAttribute('data-type', 'illustration'); inputRef.current.click() } }}>
            <ImageIcon className="h-3 w-3 mr-1" /> Illustration
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { if (inputRef.current) { inputRef.current.setAttribute('data-type', 'map'); inputRef.current.click() } }}>
            <Map className="h-3 w-3 mr-1" /> Plan / Carte
          </Button>
        </div>
      </div>
      {generateImages.isError && <p className="text-xs text-destructive">{(generateImages.error as Error).message}</p>}

      <input
        ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => {
          const type = inputRef.current?.getAttribute('data-type') ?? 'illustration'
          handleFiles(e.target.files, type)
          e.target.value = ''
        }}
      />

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 text-center text-xs text-muted-foreground hover:border-muted-foreground/40 transition-colors"
      >
        {upload.isPending ? 'Upload en cours…' : 'Glissez des images ici'}
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map(img => (
            <div key={img.id} className="group relative rounded-md overflow-hidden border bg-muted/30">
              <img
                src={img.url}
                alt={img.label || img.type}
                className="w-full h-24 object-cover cursor-pointer"
                onClick={() => setLightbox(img)}
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 space-y-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <input
                  defaultValue={img.label}
                  onBlur={e => updateMeta.mutate({ imageId: img.id, label: e.target.value, type: img.type })}
                  placeholder="Label…"
                  className="w-full bg-transparent text-white text-xs outline-none placeholder:text-white/50"
                />
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => updateMeta.mutate({ imageId: img.id, label: img.label, type: img.type === 'map' ? 'illustration' : 'map' })}
                    className="text-white/70 hover:text-white text-xs"
                  >
                    {img.type === 'map' ? '🗺 Plan' : '🖼 Illus.'}
                  </button>
                  <button onClick={() => deleteImg.mutate(img.id)} className="text-white/70 hover:text-red-400">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightbox.url} alt={lightbox.label} className="max-w-[90vw] max-h-[90vh] object-contain" />
          {lightbox.label && <p className="absolute bottom-6 text-white text-sm">{lightbox.label}</p>}
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

export default function LocationEditorModal({ locationId, campaignId, open, onClose }: Props) {
  const qc = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef<Partial<{ name: string; city: string; district: string; description: string; atmosphere: string }>>({})

  const { data: loc, isLoading } = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => api.get<CampaignLocation>(`/campaigns/${campaignId}/locations/${locationId}`),
    enabled: open && !!locationId,
  })

  const [local, setLocal] = useState({ name: '', city: '', district: '', description: '', atmosphere: '' })
  const prevIdRef = useRef('')

  useEffect(() => {
    if (loc && loc.id !== prevIdRef.current) {
      prevIdRef.current = loc.id
      setLocal({ name: loc.name, city: loc.city, district: loc.district, description: loc.description, atmosphere: loc.atmosphere })
      draftRef.current = {}
    }
  }, [loc])

  const [llmSuggestion, setLlmSuggestion] = useState<{ description: string; atmosphere: string } | null>(null)

  const save = useMutation({
    mutationFn: (patch: Partial<typeof local>) =>
      api.put<CampaignLocation>(`/campaigns/${campaignId}/locations/${locationId}`, {
        name: local.name,
        city: local.city,
        district: local.district,
        description: local.description,
        atmosphere: local.atmosphere,
        images: loc?.images ?? '[]',
        ...patch,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['location', locationId], updated)
      qc.invalidateQueries({ queryKey: ['campaign-locations', campaignId] })
    },
  })

  const develop = useMutation({
    mutationFn: () => api.post<{ description: string; atmosphere: string }>(
      `/campaigns/${campaignId}/locations/${locationId}/llm/develop`, {}
    ),
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
    const patch = { description: llmSuggestion.description, atmosphere: llmSuggestion.atmosphere }
    setLocal(l => ({ ...l, ...patch }))
    save.mutate(patch)
    setLlmSuggestion(null)
  }

  function handleLocationUpdated(updated: CampaignLocation) {
    qc.setQueryData(['location', locationId], updated)
    qc.invalidateQueries({ queryKey: ['campaign-locations', campaignId] })
  }

  const images: LocationImage[] = (() => {
    try { return JSON.parse(loc?.images ?? '[]') } catch { return [] }
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
                  placeholder="Nom du lieu"
                />
              )}
            </DialogTitle>
          </DialogHeader>

          {!isLoading && loc && (
            <div className="space-y-5">
              {/* City + District */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ville</p>
                  <Input value={local.city} onChange={e => handle('city', e.target.value)} placeholder="Ex : Martelburg" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quartier</p>
                  <Input value={local.district} onChange={e => handle('district', e.target.value)} placeholder="Ex : Quartier des docks" className="h-8 text-sm" />
                </div>
              </div>

              {/* Atmosphere */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Atmosphère</p>
                <Input
                  value={local.atmosphere}
                  onChange={e => handle('atmosphere', e.target.value)}
                  placeholder="Glauque, industriel, humide… une phrase courte"
                  className="h-8 text-sm"
                />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-xs"
                    disabled={develop.isPending}
                    onClick={() => develop.mutate()}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    {develop.isPending ? 'Génération…' : 'Développer avec le LLM'}
                  </Button>
                </div>
                {develop.isError && (
                  <p className="text-xs text-destructive">{(develop.error as Error).message}</p>
                )}
                <AutoTextarea
                  value={local.description}
                  onChange={v => handle('description', v)}
                  placeholder="Décrivez le lieu — décor, ambiance, odeurs, sons…"
                  className="min-h-[120px]"
                />
              </div>

              {/* Images */}
              <ImageGrid
                images={images}
                locationId={locationId}
                campaignId={campaignId}
                onUpdated={handleLocationUpdated}
              />

              {save.isPending && (
                <p className="text-xs text-muted-foreground text-right">Sauvegarde…</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {llmSuggestion && loc && (
        <DevelopReviewDialog
          current={{ description: loc.description, atmosphere: loc.atmosphere }}
          suggestion={llmSuggestion}
          open={!!llmSuggestion}
          onApply={applyLlmSuggestion}
          onClose={() => setLlmSuggestion(null)}
        />
      )}
    </>
  )
}
