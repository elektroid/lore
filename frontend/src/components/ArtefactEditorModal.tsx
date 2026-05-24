import { useEffect, useRef, useState } from 'react'
import { Sparkles, Upload, Trash2, ImageIcon, X, Images, Loader2, Link2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { CampaignArtefact, ArtefactImage, NPCArtefactLink, PendingImage } from '@/types/entities'
import type { CampaignNPC } from '@/types/entities'
import { api } from '@/api/client'
import ImageCandidatePicker from '@/components/ImageCandidatePicker'

interface Props {
  artefactId: string
  campaignId: string
  open: boolean
  onClose: () => void
}

// ── Auto-grow textarea ────────────────────────────────────────────────────────

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
  current: string
  suggestion: string
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
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actuel</p>
            <p className="rounded border bg-muted/50 px-3 py-2 text-xs whitespace-pre-wrap select-all min-h-[80px]">
              {current || <span className="italic text-muted-foreground">(vide)</span>}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">Nouveau</p>
            <p className="rounded border border-primary/30 bg-primary/5 px-3 py-2 text-xs whitespace-pre-wrap select-all min-h-[80px]">
              {suggestion}
            </p>
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

// ── Main modal ────────────────────────────────────────────────────────────────

export default function ArtefactEditorModal({ artefactId, campaignId, open, onClose }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [llmSuggestion, setLlmSuggestion] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<PendingImage[]>([])
  const [candidatePickerOpen, setCandidatePickerOpen] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const { data: artefact, isLoading } = useQuery({
    queryKey: ['artefact', artefactId],
    queryFn: () => api.get<CampaignArtefact>(`/campaigns/${campaignId}/artefacts/${artefactId}`),
    enabled: open && !!artefactId,
  })

  const { data: links = [] } = useQuery({
    queryKey: ['artefact-links', artefactId],
    queryFn: () => api.get<NPCArtefactLink[]>(`/campaigns/${campaignId}/artefacts/${artefactId}/links`),
    enabled: open && !!artefactId,
  })

  const { data: npcs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
    enabled: open,
  })

  useEffect(() => {
    if (artefact) {
      setName(artefact.name)
      setDescription(artefact.description)
    }
  }, [artefact])

  const images: ArtefactImage[] = (() => {
    try { return JSON.parse(artefact?.images ?? '[]') } catch { return [] }
  })()

  const invalidateArtefact = () => {
    qc.invalidateQueries({ queryKey: ['artefact', artefactId] })
    qc.invalidateQueries({ queryKey: ['campaign-artefacts', campaignId] })
  }

  const save = useMutation({
    mutationFn: () => api.put<CampaignArtefact>(`/campaigns/${campaignId}/artefacts/${artefactId}`, {
      name, description, images: artefact?.images ?? '[]',
    }),
    onSuccess: invalidateArtefact,
  })

  const develop = useMutation({
    mutationFn: () => api.post<{ description: string }>(
      `/campaigns/${campaignId}/artefacts/${artefactId}/llm/develop`, {}
    ),
    onSuccess: (data) => setLlmSuggestion(data.description),
  })

  const generateImages = useMutation({
    mutationFn: () => api.post<PendingImage[]>(
      `/campaigns/${campaignId}/artefacts/${artefactId}/llm/generate-images`, {}
    ),
    onSuccess: (data) => { setCandidates(data); setCandidatePickerOpen(true) },
  })

  const confirmImages = useMutation({
    mutationFn: (selected: string[]) => api.post<CampaignArtefact>(
      `/campaigns/${campaignId}/artefacts/${artefactId}/llm/confirm-images`, { selected }
    ),
    onSuccess: () => { setCandidatePickerOpen(false); setCandidates([]); invalidateArtefact() },
  })

  const uploadImage = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.upload<CampaignArtefact>(`/campaigns/${campaignId}/artefacts/${artefactId}/images`, fd)
    },
    onSuccess: invalidateArtefact,
  })

  const deleteImage = useMutation({
    mutationFn: (imageId: string) => api.delete(`/campaigns/${campaignId}/artefacts/${artefactId}/images/${imageId}`),
    onSuccess: invalidateArtefact,
  })

  const invalidateLinks = () => qc.invalidateQueries({ queryKey: ['artefact-links', artefactId] })

  const [npcLinkId, setNpcLinkId] = useState('')
  const [npcLinkNature, setNpcLinkNature] = useState('')
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)

  const createLink = useMutation({
    mutationFn: () => api.post<NPCArtefactLink>(`/campaigns/${campaignId}/artefacts/${artefactId}/links`, {
      npc_id: npcLinkId, nature: npcLinkNature,
    }),
    onSuccess: () => { invalidateLinks(); setLinkDialogOpen(false); setNpcLinkId(''); setNpcLinkNature('') },
  })

  const deleteLink = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${campaignId}/artefacts/${artefactId}/links/${id}`),
    onSuccess: invalidateLinks,
  })

  const isDirty = artefact && (name !== artefact.name || description !== artefact.description)

  const linkedNpcIds = new Set(links.map(l => l.npc_id))
  const availableNpcs = npcs.filter(n => !linkedNpcIds.has(n.id))

  return (
    <>
      <Dialog open={open} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Artefact</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Name */}
              <div className="space-y-1">
                <Label className="text-xs">Nom</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nom de l'artefact" className="h-8 text-sm" />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Description</Label>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-xs"
                    disabled={develop.isPending || !name.trim()}
                    onClick={() => develop.mutate()}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    {develop.isPending ? 'Génération…' : 'Développer'}
                  </Button>
                </div>
                {develop.isError && <p className="text-xs text-destructive">{(develop.error as Error).message}</p>}
                <AutoTextarea
                  value={description}
                  onChange={setDescription}
                  placeholder="Description mystérieuse de l'artefact…"
                />
              </div>

              {/* Images */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Illustrations</Label>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm" variant="ghost" className="h-6 px-2 text-xs"
                      disabled={generateImages.isPending || !name.trim()}
                      onClick={() => generateImages.mutate()}
                    >
                      <Images className="h-3 w-3 mr-1" />
                      {generateImages.isPending ? 'Génération…' : 'Générer'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => fileRef.current?.click()}>
                      <Upload className="h-3 w-3 mr-1" /> Importer
                    </Button>
                  </div>
                </div>
                {generateImages.isError && <p className="text-xs text-destructive">{(generateImages.error as Error).message}</p>}

                {images.length === 0 ? (
                  <div className="rounded border border-dashed border-muted-foreground/30 p-6 flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageIcon className="h-6 w-6 opacity-40" />
                    <p className="text-xs">Aucune illustration</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {images.map(img => (
                      <div key={img.id} className="relative group">
                        <img
                          src={img.url}
                          alt={img.label || ''}
                          className="h-20 w-20 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setLightboxUrl(img.url)}
                        />
                        <button
                          className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => deleteImage.mutate(img.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage.mutate(f); e.target.value = '' }}
                />
              </div>

              {/* NPC links */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">PNJs liés</Label>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-xs"
                    onClick={() => setLinkDialogOpen(true)}
                    disabled={availableNpcs.length === 0}
                  >
                    <Link2 className="h-3 w-3 mr-1" /> Lier un PNJ
                  </Button>
                </div>
                {links.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun PNJ lié.</p>
                ) : (
                  <ul className="space-y-1">
                    {links.map(link => (
                      <li key={link.id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                        <span className="font-medium text-sm">{link.npc_name}</span>
                        {link.nature && <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{link.nature}</span>}
                        <Button
                          size="sm" variant="ghost" className="h-5 w-5 p-0 ml-auto text-muted-foreground hover:text-destructive"
                          onClick={() => deleteLink.mutate(link.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            <Button disabled={!isDirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Sauvegarde…' : 'Sauvegarder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LLM develop review */}
      {llmSuggestion !== null && (
        <DevelopReviewDialog
          current={description}
          suggestion={llmSuggestion}
          open={true}
          onApply={() => { setDescription(llmSuggestion); setLlmSuggestion(null) }}
          onClose={() => setLlmSuggestion(null)}
        />
      )}

      {/* Image candidate picker */}
      <ImageCandidatePicker
        candidates={candidates}
        open={candidatePickerOpen}
        onConfirm={selected => confirmImages.mutate(selected)}
        onClose={() => { setCandidatePickerOpen(false); setCandidates([]) }}
      />

      {/* NPC link dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={o => !o && setLinkDialogOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Lier un PNJ</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">PNJ</Label>
              <select
                value={npcLinkId}
                onChange={e => setNpcLinkId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Sélectionner…</option>
                {availableNpcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nature du lien</Label>
              <Input
                value={npcLinkNature}
                onChange={e => setNpcLinkNature(e.target.value)}
                placeholder="Propriétaire, porteur, créateur…"
                className="h-7 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Annuler</Button>
            <Button disabled={!npcLinkId || createLink.isPending} onClick={() => createLink.mutate()}>
              {createLink.isPending ? 'Création…' : 'Lier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
        >
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightboxUrl(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </>
  )
}
