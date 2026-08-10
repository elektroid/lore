import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Check, X, Search } from 'lucide-react'
import AppShell from '@/components/AppShell'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import LocationEditorModal from '@/components/LocationEditorModal'
import NPCEditorModal from '@/components/NPCEditorModal'
import ArtefactEditorModal from '@/components/ArtefactEditorModal'
import FactionEditorModal from '@/components/FactionEditorModal'
import EntityAvatar from '@/components/EntityAvatar'
import SearchDialog from '@/components/SearchDialog'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import { stripMentions } from '@/lib/mentions'
import type { Campaign } from '@/types/campaign'
import type { CampaignNPC, NPCImage, CampaignLocation, LocationImage, CampaignArtefact, ArtefactImage, CampaignFaction, FactionImage } from '@/types/entities'

// ── Auto-resize textarea ──────────────────────────────────────────────────────

function AutoTextarea({ value, onChange, placeholder, disabled, rows = 2 }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; disabled?: boolean; rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => {
        onChange(e.target.value)
        if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = ref.current.scrollHeight + 'px' }
      }}
      className="w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    />
  )
}

// ── NPC form fields (module-level to avoid remount on re-render) ──────────────

type NPCForm = { name: string; role: string; description: string; quote: string }
const emptyNPC = (): NPCForm => ({ name: '', role: '', description: '', quote: '' })

function NPCFormFields({ f, set }: { f: NPCForm; set: (p: Partial<NPCForm>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nom</Label>
          <Input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Nom du PNJ" className="h-7 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rôle</Label>
          <Input value={f.role} onChange={e => set({ role: e.target.value })} placeholder="Rôle dans l'histoire" className="h-7 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <AutoTextarea value={f.description} onChange={v => set({ description: v })} placeholder="Description physique, psychologie, motivations…" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Réplique type</Label>
        <Input value={f.quote} onChange={e => set({ quote: e.target.value })} placeholder="«…»" className="h-7 text-sm italic" />
      </div>
    </div>
  )
}

// ── NPC tab ───────────────────────────────────────────────────────────────────

function NPCTab({ campaignId, gameId, openId, creating, onCreatingChange, form, onFormChange }: {
  campaignId: string; gameId?: string; openId?: string
  creating: boolean; onCreatingChange: (v: boolean) => void
  form: NPCForm; onFormChange: (f: NPCForm) => void
}) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<{ url: string; label: string } | null>(null)

  useEffect(() => { if (openId) setEditId(openId) }, [openId])

  const { data: npcs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaign-npcs', campaignId] })

  const create = useMutation({
    mutationFn: (f: NPCForm) => api.post<CampaignNPC>(`/campaigns/${campaignId}/npcs`, f),
    onSuccess: (npc) => { invalidate(); onCreatingChange(false); onFormChange(emptyNPC()); setEditId(npc.id) },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${campaignId}/npcs/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { onCreatingChange(true); onFormChange(emptyNPC()) }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter un PNJ
        </Button>
      </div>

      {npcs.length === 0 && !creating && (
        <p className="text-xs text-muted-foreground">Aucun PNJ de campagne.</p>
      )}

      <ul className="space-y-2">
        {npcs.map(npc => {
          const npcImages: NPCImage[] = (() => { try { return JSON.parse(npc.images) } catch { return [] } })()
          const first = npcImages[0] ?? null
          return (
            <li key={npc.id} className="rounded-md border bg-card p-3 space-y-1">
              <div className="flex items-start gap-3">
                <EntityAvatar name={npc.name} imageUrl={first?.url} onImageClick={() => first && setLightboxImg(first)} />
                <div className="flex-1 min-w-0">
                  <button className="text-sm font-medium truncate hover:underline text-left" onClick={() => setEditId(npc.id)}>
                    {npc.name || <span className="text-muted-foreground italic">(sans nom)</span>}
                  </button>
                  {npc.role && <p className="text-xs text-muted-foreground truncate">{npc.role}</p>}
                  {npc.motivation && npc.motivation !== npc.role && <p className="text-xs text-primary/80 italic truncate">{npc.motivation}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditId(npc.id)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(npc.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <Dialog open={creating} onOpenChange={o => !o && onCreatingChange(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un PNJ</DialogTitle>
          </DialogHeader>
          <NPCFormFields f={form} set={p => onFormChange({ ...form, ...p })} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onCreatingChange(false)}><X className="h-3.5 w-3.5 mr-1" /> Annuler</Button>
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate(form)}>
              <Check className="h-3.5 w-3.5 mr-1" /> Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editId && (
        <NPCEditorModal
          npcId={editId}
          campaignId={campaignId}
          gameId={gameId}
          open={!!editId}
          onClose={() => setEditId(null)}
        />
      )}

      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setLightboxImg(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightboxImg(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightboxImg.url} alt={lightboxImg.label} className="max-w-[90vw] max-h-[90vh] object-contain" />
          {lightboxImg.label && <p className="absolute bottom-6 text-white text-sm">{lightboxImg.label}</p>}
        </div>
      )}
    </div>
  )
}

// ── Location form fields (module-level) ───────────────────────────────────────

type LocForm = { name: string; description: string; atmosphere: string }
const emptyLoc = (): LocForm => ({ name: '', description: '', atmosphere: '' })

function LocFormFields({ f, set }: { f: LocForm; set: (p: Partial<LocForm>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nom</Label>
          <Input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Nom du lieu" className="h-7 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Atmosphère</Label>
          <Input value={f.atmosphere} onChange={e => set({ atmosphere: e.target.value })} placeholder="Glauque, industriel…" className="h-7 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <AutoTextarea value={f.description} onChange={v => set({ description: v })} placeholder="Décor, odeurs, ambiance…" />
      </div>
    </div>
  )
}

// ── Location tab ──────────────────────────────────────────────────────────────

function LocationTab({ campaignId, openId, creating, onCreatingChange, form, onFormChange }: {
  campaignId: string; openId?: string
  creating: boolean; onCreatingChange: (v: boolean) => void
  form: LocForm; onFormChange: (f: LocForm) => void
}) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<LocationImage | null>(null)

  useEffect(() => { if (openId) setEditId(openId) }, [openId])

  const { data: locs = [] } = useQuery({
    queryKey: ['campaign-locations', campaignId],
    queryFn: () => api.get<CampaignLocation[]>(`/campaigns/${campaignId}/locations`),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaign-locations', campaignId] })

  const create = useMutation({
    mutationFn: (f: LocForm) => api.post<CampaignLocation>(`/campaigns/${campaignId}/locations`, f),
    onSuccess: (loc) => { invalidate(); onCreatingChange(false); onFormChange(emptyLoc()); setEditId(loc.id) },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${campaignId}/locations/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { onCreatingChange(true); onFormChange(emptyLoc()) }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter un lieu
        </Button>
      </div>

      {locs.length === 0 && !creating && (
        <p className="text-xs text-muted-foreground">Aucun lieu de campagne.</p>
      )}

      <ul className="space-y-2">
        {locs.map(loc => {
          const images: LocationImage[] = (() => { try { return JSON.parse(loc.images) } catch { return [] } })()
          const first = images[0] ?? null
          return (
            <li key={loc.id} className="rounded-md border bg-card p-3">
              <div className="flex items-start gap-3">
                <EntityAvatar name={loc.name} imageUrl={first?.url} onImageClick={() => first && setLightboxImg(first)} />
                <div className="flex-1 min-w-0">
                  <button className="text-sm font-medium truncate hover:underline text-left" onClick={() => setEditId(loc.id)}>{loc.name || <span className="text-muted-foreground italic">(sans nom)</span>}</button>
                  {loc.atmosphere && <p className="text-xs text-muted-foreground truncate">{loc.atmosphere}</p>}
                  {loc.description && loc.description !== loc.atmosphere && (
                    <p className={`text-xs text-muted-foreground mt-1 ${loc.atmosphere ? 'truncate' : 'line-clamp-2'}`}>
                      {stripMentions(loc.description)}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditId(loc.id)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(loc.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <Dialog open={creating} onOpenChange={o => !o && onCreatingChange(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un lieu</DialogTitle>
          </DialogHeader>
          <LocFormFields f={form} set={p => onFormChange({ ...form, ...p })} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onCreatingChange(false)}><X className="h-3.5 w-3.5 mr-1" /> Annuler</Button>
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate(form)}>
              <Check className="h-3.5 w-3.5 mr-1" /> Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editId && (
        <LocationEditorModal
          locationId={editId}
          campaignId={campaignId}
          open={!!editId}
          onClose={() => setEditId(null)}
        />
      )}

      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxImg(null)}
        >
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightboxImg(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightboxImg.url} alt={lightboxImg.label} className="max-w-[90vw] max-h-[90vh] object-contain" />
          {lightboxImg.label && <p className="absolute bottom-6 text-white text-sm">{lightboxImg.label}</p>}
        </div>
      )}
    </div>
  )
}

// ── Faction tab ───────────────────────────────────────────────────────────────

type FactionForm = { name: string; type: string; description: string; motivation: string }
const emptyFaction = (): FactionForm => ({ name: '', type: '', description: '', motivation: '' })

function FactionTab({ campaignId, openId, creating, onCreatingChange, form, onFormChange }: {
  campaignId: string; openId?: string
  creating: boolean; onCreatingChange: (v: boolean) => void
  form: FactionForm; onFormChange: (f: FactionForm) => void
}) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<{ url: string; label: string } | null>(null)

  useEffect(() => { if (openId) setEditId(openId) }, [openId])

  const { data: factions = [] } = useQuery({
    queryKey: ['campaign-factions', campaignId],
    queryFn: () => api.get<CampaignFaction[]>(`/campaigns/${campaignId}/factions`),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaign-factions', campaignId] })

  const create = useMutation({
    mutationFn: (f: FactionForm) => api.post<CampaignFaction>(`/campaigns/${campaignId}/factions`, f),
    onSuccess: (faction) => { invalidate(); onCreatingChange(false); onFormChange(emptyFaction()); setEditId(faction.id) },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${campaignId}/factions/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { onCreatingChange(true); onFormChange(emptyFaction()) }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter une faction
        </Button>
      </div>

      {factions.length === 0 && !creating && (
        <p className="text-xs text-muted-foreground">Aucune faction de campagne.</p>
      )}

      <ul className="space-y-2">
        {factions.map(f => {
          const factionImages: FactionImage[] = (() => { try { return JSON.parse(f.images) } catch { return [] } })()
          const first = factionImages[0] ?? null
          return (
            <li key={f.id} className="rounded-md border bg-card p-3">
              <div className="flex items-start gap-3">
                <EntityAvatar name={f.name} imageUrl={first?.url} onImageClick={() => first && setLightboxImg(first)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button className="text-sm font-medium truncate hover:underline text-left" onClick={() => setEditId(f.id)}>{f.name || <span className="text-muted-foreground italic">(sans nom)</span>}</button>
                    {f.type && <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{f.type}</span>}
                  </div>
                  {f.motivation && <p className="text-xs text-primary/80 italic truncate mt-0.5">{f.motivation}</p>}
                  {f.description && f.description !== f.motivation && (
                    <p className={`text-xs text-muted-foreground mt-1 ${f.motivation ? 'truncate' : 'line-clamp-2'}`}>
                      {stripMentions(f.description)}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditId(f.id)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(f.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <Dialog open={creating} onOpenChange={o => !o && onCreatingChange(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter une faction</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nom</Label>
                <Input value={form.name} onChange={e => onFormChange({ ...form, name: e.target.value })} placeholder="Nom de la faction" className="h-7 text-sm" autoFocus />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Input value={form.type} onChange={e => onFormChange({ ...form, type: e.target.value })} placeholder="Corporation, gang…" className="h-7 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <AutoTextarea value={form.description} onChange={v => onFormChange({ ...form, description: v })} placeholder="Présentation, structure, histoire…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Motivation</Label>
              <Input value={form.motivation} onChange={e => onFormChange({ ...form, motivation: e.target.value })} placeholder="Ce qui fait agir la faction…" className="h-7 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onCreatingChange(false)}><X className="h-3.5 w-3.5 mr-1" /> Annuler</Button>
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate(form)}>
              <Check className="h-3.5 w-3.5 mr-1" /> Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editId && (
        <FactionEditorModal
          factionId={editId}
          campaignId={campaignId}
          open={!!editId}
          onClose={() => setEditId(null)}
        />
      )}

      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setLightboxImg(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightboxImg(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightboxImg.url} alt={lightboxImg.label} className="max-w-[90vw] max-h-[90vh] object-contain" />
          {lightboxImg.label && <p className="absolute bottom-6 text-white text-sm">{lightboxImg.label}</p>}
        </div>
      )}
    </div>
  )
}

// ── Artefact tab ──────────────────────────────────────────────────────────────

type ArtefactForm = { name: string; description: string }
const emptyArtefact = (): ArtefactForm => ({ name: '', description: '' })

function ArtefactTab({ campaignId, openId, creating, onCreatingChange, form, onFormChange }: {
  campaignId: string; openId?: string
  creating: boolean; onCreatingChange: (v: boolean) => void
  form: ArtefactForm; onFormChange: (f: ArtefactForm) => void
}) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<{ url: string; label: string } | null>(null)

  useEffect(() => { if (openId) setEditId(openId) }, [openId])

  const { data: artefacts = [] } = useQuery({
    queryKey: ['campaign-artefacts', campaignId],
    queryFn: () => api.get<CampaignArtefact[]>(`/campaigns/${campaignId}/artefacts`),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaign-artefacts', campaignId] })

  const create = useMutation({
    mutationFn: (f: ArtefactForm) => api.post<CampaignArtefact>(`/campaigns/${campaignId}/artefacts`, f),
    onSuccess: (a) => { invalidate(); onCreatingChange(false); onFormChange(emptyArtefact()); setEditId(a.id) },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${campaignId}/artefacts/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { onCreatingChange(true); onFormChange(emptyArtefact()) }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter un artefact
        </Button>
      </div>

      {artefacts.length === 0 && !creating && (
        <p className="text-xs text-muted-foreground">Aucun artefact de campagne.</p>
      )}

      <ul className="space-y-2">
        {artefacts.map(a => {
          const images: ArtefactImage[] = (() => { try { return JSON.parse(a.images) } catch { return [] } })()
          const first = images[0] ?? null
          return (
            <li key={a.id} className="rounded-md border bg-card p-3">
              <div className="flex items-start gap-3">
                <EntityAvatar name={a.name} imageUrl={first?.url} onImageClick={() => first && setLightboxImg(first)} />
                <div className="flex-1 min-w-0">
                  <button className="text-sm font-medium truncate hover:underline text-left" onClick={() => setEditId(a.id)}>
                    {a.name || <span className="text-muted-foreground italic">(sans nom)</span>}
                  </button>
                  {a.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{stripMentions(a.description)}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditId(a.id)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(a.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <Dialog open={creating} onOpenChange={o => !o && onCreatingChange(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un artefact</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Nom</Label>
            <Input value={form.name} onChange={e => onFormChange({ ...form, name: e.target.value })} placeholder="Nom de l'artefact" className="h-7 text-sm" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onCreatingChange(false)}><X className="h-3.5 w-3.5 mr-1" /> Annuler</Button>
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate(form)}>
              <Check className="h-3.5 w-3.5 mr-1" /> Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editId && (
        <ArtefactEditorModal
          artefactId={editId}
          campaignId={campaignId}
          open={!!editId}
          onClose={() => setEditId(null)}
        />
      )}

      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setLightboxImg(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightboxImg(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightboxImg.url} alt={lightboxImg.label} className="max-w-[90vw] max-h-[90vh] object-contain" />
          {lightboxImg.label && <p className="absolute bottom-6 text-white text-sm">{lightboxImg.label}</p>}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignEntitiesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('npcs')
  const [searchOpen, setSearchOpen] = useState(false)
  const [openIds, setOpenIds] = useState<Record<string, string | undefined>>({})

  // Creation form state lifted here so it persists across tab switches
  const [npcCreating, setNpcCreating] = useState(false)
  const [npcForm, setNpcForm] = useState<NPCForm>(emptyNPC())
  const [locCreating, setLocCreating] = useState(false)
  const [locForm, setLocForm] = useState<LocForm>(emptyLoc())
  const [artCreating, setArtCreating] = useState(false)
  const [artForm, setArtForm] = useState<ArtefactForm>(emptyArtefact())
  const [facCreating, setFacCreating] = useState(false)
  const [facForm, setFacForm] = useState<FactionForm>(emptyFaction())

  const hasContent = (o: Record<string, string>) => Object.values(o).some(v => v.trim() !== '')
  const isDirty =
    (npcCreating && hasContent(npcForm)) ||
    (locCreating && hasContent(locForm)) ||
    (artCreating && artForm.name.trim() !== '') ||
    (facCreating && hasContent(facForm))
  const { guardDialog } = useUnsavedGuard(isDirty)

  const { data: campaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get<Campaign>(`/campaigns/${id}`),
  })

  useDocTitle(campaign ? `lore: ${campaign.name} — entités` : 'lore')

  function handleSearchSelect(tab: string, entityId: string) {
    setActiveTab(tab)
    setOpenIds(prev => ({ ...prev, [tab]: entityId }))
  }

  // Entity editing is authoring — owner-only, even for a delegated
  // gamemaster (who reads NPCs/locations through PlayPage's own roster
  // instead). See AccessSection in CampaignDetailPage.tsx.
  const isNonOwner = campaign != null && campaign.access !== 'owner'
  useEffect(() => {
    if (isNonOwner) navigate(`/campaigns/${id}/runs`, { replace: true })
  }, [isNonOwner, id, navigate])
  if (isNonOwner) return null

  return (
    <AppShell
      crumbs={[{ label: campaign?.name ?? '…', to: `/campaigns/${id}` }, { label: 'Entités' }]}
      modeTabs={[
        { label: 'Auteur', to: `/campaigns/${id}`, active: true },
        { label: 'Meneur', to: `/campaigns/${id}/runs`, active: false },
      ]}
    >
      <main className="max-w-3xl mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-6">
            <TabsList>
              <TabsTrigger value="npcs">PNJs</TabsTrigger>
              <TabsTrigger value="locations">Lieux</TabsTrigger>
              <TabsTrigger value="artefacts">Artefacts</TabsTrigger>
              <TabsTrigger value="factions">Factions</TabsTrigger>
            </TabsList>
            <Button size="sm" variant="outline" className="h-8 px-3 text-xs gap-1.5" onClick={() => setSearchOpen(true)}>
              <Search className="h-3.5 w-3.5" />
              Rechercher
            </Button>
          </div>
          <TabsContent value="npcs"><NPCTab campaignId={id!} gameId={campaign?.game_id} openId={openIds['npcs']} creating={npcCreating} onCreatingChange={setNpcCreating} form={npcForm} onFormChange={setNpcForm} /></TabsContent>
          <TabsContent value="locations"><LocationTab campaignId={id!} openId={openIds['locations']} creating={locCreating} onCreatingChange={setLocCreating} form={locForm} onFormChange={setLocForm} /></TabsContent>
          <TabsContent value="artefacts"><ArtefactTab campaignId={id!} openId={openIds['artefacts']} creating={artCreating} onCreatingChange={setArtCreating} form={artForm} onFormChange={setArtForm} /></TabsContent>
          <TabsContent value="factions"><FactionTab campaignId={id!} openId={openIds['factions']} creating={facCreating} onCreatingChange={setFacCreating} form={facForm} onFormChange={setFacForm} /></TabsContent>
        </Tabs>
      </main>

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        campaignId={id!}
        onSelect={handleSearchSelect}
      />
      {guardDialog}
    </AppShell>
  )
}
