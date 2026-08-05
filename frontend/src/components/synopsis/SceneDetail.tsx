import { useEffect, useRef, useState } from 'react'
import { MapPin, Plus, X, Search, ArrowLeftRight, Sparkles, Package, Play, Flag } from 'lucide-react'
import LocationEditorModal from '@/components/LocationEditorModal'
import NPCEditorModal from '@/components/NPCEditorModal'
import ArtefactEditorModal from '@/components/ArtefactEditorModal'
import NPCCard from './NPCCard'
import MentionEditor from '@/components/MentionEditor'
import { stripMentions } from '@/lib/mentions'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Scene, SceneStatus } from '@/types/synopsis'
import { SCENE_STATUS_LABELS } from '@/types/synopsis'
import type { CampaignNPC, CampaignLocation, LocationImage, CampaignArtefact } from '@/types/entities'
import type { Campaign } from '@/types/campaign'
import type { GameLoreEntity, GameLoreEntitiesPage } from '@/types/game'
import { api } from '@/api/client'
import { patchCachedListItem } from '@/api/cache'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import LLMSuggestionReview, { type SuggestionField } from '@/components/LLMSuggestionReview'

interface Props {
  scenarioId: string
  campaignId: string
  scene: Scene
}

type ScenePatch = Partial<{
  title: string; status: SceneStatus; description: string; outcome: string; notes: string
  location_id: string; is_start: boolean; is_end: boolean
}>

const SCENE_SUGGESTION_FIELDS: SuggestionField[] = [
  { key: 'description', label: 'Ce qui se passe', multiline: true },
  { key: 'outcome', label: 'Dénouement', multiline: true },
  { key: 'notes', label: 'Notes', multiline: true },
]

// ── Auto-grow textarea ────────────────────────────────────────────────────────

function AutoTextarea({ value, onChange, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={2}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    />
  )
}

// ── Location picker ───────────────────────────────────────────────────────────

function LocationPicker({
  campaignId, open, onClose, onPick,
}: {
  campaignId: string; open: boolean; onClose: () => void; onPick: (loc: CampaignLocation) => void
}) {
  const [search, setSearch] = useState('')
  const [loreSearch, setLoreSearch] = useState('')
  const [debouncedLoreSearch, setDebouncedLoreSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [mode, setMode] = useState<'pick' | 'lore' | 'create'>('pick')
  const qc = useQueryClient()

  const { data: campaign } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<Campaign>(`/campaigns/${campaignId}`),
    enabled: open,
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['campaign-locations', campaignId],
    queryFn: () => api.get<CampaignLocation[]>(`/campaigns/${campaignId}/locations`),
    enabled: open,
  })

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLoreSearch(loreSearch.trim()), 250)
    return () => clearTimeout(t)
  }, [loreSearch])

  const gameId = campaign?.game_id ?? ''
  const { data: loreResults = [] } = useQuery({
    queryKey: ['game-lore-locations', gameId, debouncedLoreSearch],
    queryFn: () => {
      const params = new URLSearchParams({ kind: 'location', page_size: '20' })
      if (debouncedLoreSearch) params.set('q', debouncedLoreSearch)
      return api.get<GameLoreEntitiesPage>(`/games/${gameId}/lore-entities?${params.toString()}`)
        .then(p => p.entities)
    },
    enabled: open && mode === 'lore' && !!gameId,
  })

  const create = useMutation({
    mutationFn: (name: string) =>
      api.post<CampaignLocation>(`/campaigns/${campaignId}/locations`, { name, description: '', atmosphere: '' }),
    onSuccess: (loc) => { qc.invalidateQueries({ queryKey: ['campaign-locations', campaignId] }); onPick(loc) },
  })

  const importLore = useMutation({
    mutationFn: (entity: GameLoreEntity) =>
      api.post<CampaignLocation>(`/campaigns/${campaignId}/locations`, {
        name: entity.name, description: entity.summary || entity.excerpt, atmosphere: '',
      }),
    onSuccess: (loc) => { qc.invalidateQueries({ queryKey: ['campaign-locations', campaignId] }); onPick(loc) },
  })

  const filtered = locations.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.atmosphere.toLowerCase().includes(search.toLowerCase()),
  )

  function close() { setSearch(''); setLoreSearch(''); setNewName(''); setMode('pick'); onClose() }

  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Choisir un lieu</DialogTitle></DialogHeader>
        <div className="flex gap-2 border-b pb-3">
          <Button size="sm" variant={mode === 'pick' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setMode('pick')}>Depuis la campagne</Button>
          {gameId && (
            <Button size="sm" variant={mode === 'lore' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setMode('lore')}>Depuis le lore</Button>
          )}
          <Button size="sm" variant={mode === 'create' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setMode('create')}>Nouveau lieu</Button>
        </div>
        {mode === 'pick' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 pl-8 text-sm" autoFocus />
            </div>
            {locations.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Aucun lieu — créez-en un.</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Aucun résultat.</p>
            ) : (
              <ul className="space-y-1 max-h-56 overflow-y-auto">
                {filtered.map(loc => (
                  <li key={loc.id}>
                    <button onClick={() => { onPick(loc); close() }} className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
                      <p className="font-medium">{loc.name}</p>
                      {loc.atmosphere && <p className="text-xs text-muted-foreground">{loc.atmosphere}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {mode === 'lore' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={loreSearch} onChange={e => setLoreSearch(e.target.value)} placeholder="Rechercher dans le lore…" className="h-8 pl-8 text-sm" autoFocus />
            </div>
            {loreResults.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Aucun résultat.</p>
            ) : (
              <ul className="space-y-1 max-h-56 overflow-y-auto">
                {loreResults.map(e => (
                  <li key={e.id}>
                    <button
                      onClick={() => importLore.mutate(e)}
                      disabled={importLore.isPending}
                      className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <p className="font-medium">{e.name}</p>
                      {e.summary && <p className="text-xs text-muted-foreground line-clamp-1">{e.summary}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {mode === 'create' && (
          <div className="space-y-3">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom du lieu" className="h-8 text-sm" autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && !create.isPending) create.mutate(newName.trim()) }} />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" className="h-7" onClick={close}>Annuler</Button>
              <Button size="sm" className="h-7" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate(newName.trim())}>
                {create.isPending ? 'Création…' : 'Créer et lier'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── NPC picker ────────────────────────────────────────────────────────────────

function NPCPicker({
  campaignId, open, existingIds, onClose, onPick,
}: {
  campaignId: string; open: boolean; existingIds: string[]; onClose: () => void; onPick: (id: string) => void
}) {
  const [search, setSearch] = useState('')

  const { data: npcs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
    enabled: open,
  })

  const available = npcs.filter(n =>
    !existingIds.includes(n.id) &&
    (n.name.toLowerCase().includes(search.toLowerCase()) || n.role.toLowerCase().includes(search.toLowerCase())),
  )

  function close() { setSearch(''); onClose() }

  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Ajouter un PNJ à la scène</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 pl-8 text-sm" autoFocus />
        </div>
        {available.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Aucun PNJ disponible.</p>
        ) : (
          <ul className="space-y-1 max-h-60 overflow-y-auto">
            {available.map(npc => (
              <li key={npc.id}>
                <button onClick={() => { onPick(npc.id); close() }} className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
                  <p className="font-medium">{npc.name}</p>
                  {npc.role && <p className="text-xs text-muted-foreground">{npc.role}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Artefact picker ───────────────────────────────────────────────────────────

function ArtefactPicker({
  campaignId, open, existingIds, onClose, onPick,
}: {
  campaignId: string; open: boolean; existingIds: string[]; onClose: () => void; onPick: (id: string) => void
}) {
  const [search, setSearch] = useState('')

  const { data: artefacts = [] } = useQuery({
    queryKey: ['campaign-artefacts', campaignId],
    queryFn: () => api.get<CampaignArtefact[]>(`/campaigns/${campaignId}/artefacts`),
    enabled: open,
  })

  const available = artefacts.filter(a =>
    !existingIds.includes(a.id) &&
    a.name.toLowerCase().includes(search.toLowerCase()),
  )

  function close() { setSearch(''); onClose() }

  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Ajouter un artefact à la scène</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 pl-8 text-sm" autoFocus />
        </div>
        {available.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Aucun artefact disponible.</p>
        ) : (
          <ul className="space-y-1 max-h-60 overflow-y-auto">
            {available.map(a => (
              <li key={a.id}>
                <button onClick={() => { onPick(a.id); close() }} className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
                  <p className="font-medium">{a.name}</p>
                  {a.description && <p className="text-xs text-muted-foreground line-clamp-1">{stripMentions(a.description)}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Scene detail panel ────────────────────────────────────────────────────────

export default function SceneDetail({ scenarioId, campaignId, scene }: Props) {
  const qc = useQueryClient()
  const draft = useDebouncedSave<ScenePatch>()
  const [local, setLocal] = useState({ title: scene.title, description: scene.description, outcome: scene.outcome, notes: scene.notes })
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [locationEditorOpen, setLocationEditorOpen] = useState(false)
  const [npcPickerOpen, setNpcPickerOpen] = useState(false)
  const [artefactPickerOpen, setArtefactPickerOpen] = useState(false)
  const [editArtefactId, setEditArtefactId] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<LocationImage | null>(null)
  const [editNpcId, setEditNpcId] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<Record<string, string> | null>(null)

  const develop = useMutation({
    mutationFn: () => api.post<Record<string, string>>(
      `/scenarios/${scenarioId}/synopsis/scenes/${scene.id}/llm/develop`, { current: local }
    ),
    onSuccess: (data) => setSuggestion(data),
  })

  async function regenerateFields(keys: string[], instruction: string) {
    return api.post<Record<string, string>>(
      `/scenarios/${scenarioId}/synopsis/scenes/${scene.id}/llm/develop`,
      { current: local, fields: keys, instruction },
    )
  }

  function acceptField(key: string, value: string) {
    setLocal(l => ({ ...l, [key]: value }))
    saveNow({ [key]: value })
  }

  const { data: locationData } = useQuery({
    queryKey: ['location', scene.location_id],
    queryFn: () => api.get<CampaignLocation>(`/campaigns/${campaignId}/locations/${scene.location_id}`),
    enabled: !!scene.location_id,
  })
  const locationImages: LocationImage[] = (() => {
    try { return JSON.parse(locationData?.images ?? '[]') } catch { return [] }
  })()

  // Sync when scene changes (different scene selected). The pending draft
  // belongs to the previous scene — save it instead of dropping it.
  useEffect(() => {
    draft.flush()
    setLocal({ title: scene.title, description: scene.description, outcome: scene.outcome, notes: scene.notes })
  }, [scene.id, draft])

  const update = useMutation({
    // The full-record PUT is built from the cached scene rather than the prop,
    // so a draft flushed after the panel switched scenes still saves against
    // the scene it was typed into.
    mutationFn: ({ sceneId, patch }: { sceneId: string; patch: ScenePatch }) => {
      const base = qc.getQueryData<Scene[]>(['scenes', scenarioId])?.find(s => s.id === sceneId) ?? scene
      return api.put<Scene>(`/scenarios/${scenarioId}/synopsis/scenes/${sceneId}`, {
        title: base.title,
        status: base.status,
        description: base.description,
        outcome: base.outcome,
        notes: base.notes,
        location_id: base.location_id,
        is_start: base.is_start,
        is_end: base.is_end,
        ...patch,
      })
    },
    onSuccess: (data) => {
      qc.setQueryData(['scenes', scenarioId], (old: Scene[] = []) =>
        // The server clears is_start on every other scene — mirror that here.
        old.map(s => s.id === data.id ? data : (data.is_start ? { ...s, is_start: false } : s)),
      )
    },
  })

  // Reflect the edit in the scene list (and the breadcrumb) right away; both
  // read the same cache entry, which otherwise only catches up once the
  // debounced PUT comes back.
  function patchScene(sceneId: string, patch: Partial<Scene>) {
    patchCachedListItem<Scene>(qc, ['scenes', scenarioId], sceneId, patch)
  }

  function handle(field: 'title' | 'description' | 'outcome' | 'notes', value: string) {
    const sceneId = scene.id
    setLocal(l => ({ ...l, [field]: value }))
    patchScene(sceneId, { [field]: value })
    draft.schedule({ [field]: value }, patch => update.mutate({ sceneId, patch }))
  }

  /** Write that must land now — flushes any pending draft with it. */
  function saveNow(patch: ScenePatch) {
    const sceneId = scene.id
    patchScene(sceneId, patch)
    draft.saveNow(patch, merged => update.mutate({ sceneId, patch: merged }))
  }

  function pickLocation(loc: CampaignLocation) {
    patchScene(scene.id, { location_name: loc.name })
    saveNow({ location_id: loc.id })
    setLocationPickerOpen(false)
  }

  function clearLocation() {
    patchScene(scene.id, { location_name: '' })
    saveNow({ location_id: '' })
  }

  const addNPC = useMutation({
    mutationFn: (npcId: string) =>
      api.post<Scene>(`/scenarios/${scenarioId}/synopsis/scenes/${scene.id}/npcs`, { npc_id: npcId }),
    onSuccess: (data) => {
      qc.setQueryData(['scenes', scenarioId], (old: Scene[] = []) =>
        old.map(s => s.id === data.id ? data : s),
      )
    },
  })

  const removeNPC = useMutation({
    mutationFn: (npcId: string) =>
      api.delete(`/scenarios/${scenarioId}/synopsis/scenes/${scene.id}/npcs/${npcId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes', scenarioId] }),
  })

  const addArtefact = useMutation({
    mutationFn: (artefactId: string) =>
      api.post<Scene>(`/scenarios/${scenarioId}/synopsis/scenes/${scene.id}/artefacts`, { artefact_id: artefactId }),
    onSuccess: (data) => {
      qc.setQueryData(['scenes', scenarioId], (old: Scene[] = []) =>
        old.map(s => s.id === data.id ? data : s),
      )
    },
  })

  const removeArtefact = useMutation({
    mutationFn: (artefactId: string) =>
      api.delete(`/scenarios/${scenarioId}/synopsis/scenes/${scene.id}/artefacts/${artefactId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes', scenarioId] }),
  })

  return (
    <div className="space-y-5">
      {/* Title + status */}
      <div className="flex items-center gap-3">
        <Input
          value={local.title}
          onChange={e => handle('title', e.target.value)}
          placeholder="Titre de la scène"
          className="text-lg font-semibold border-none shadow-none px-0 focus-visible:ring-0 h-auto flex-1"
        />
        <select
          value={scene.status}
          onChange={e => saveNow({ status: e.target.value as SceneStatus })}
          className="text-xs rounded border border-input bg-background px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
        >
          {(Object.entries(SCENE_STATUS_LABELS) as [SceneStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Start / end tags */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          title={scene.is_start ? 'Retirer le tag Départ' : 'Marquer comme scène de départ'}
          onClick={() => saveNow({ is_start: !scene.is_start })}
          className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
            scene.is_start
              ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <Play className="h-3 w-3" />
          Départ
        </button>
        <button
          type="button"
          title={scene.is_end ? 'Retirer le tag Fin' : 'Marquer comme scène de fin'}
          onClick={() => saveNow({ is_end: !scene.is_end })}
          className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
            scene.is_end
              ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950 dark:border-rose-700 dark:text-rose-400'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <Flag className="h-3 w-3" />
          Fin
        </button>
      </div>

      {/* Location */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
          {scene.location_name ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLocationEditorOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                {scene.location_name}
              </button>
              <button
                title="Changer de lieu"
                onClick={() => setLocationPickerOpen(true)}
                className="text-muted-foreground/40 hover:text-muted-foreground"
              >
                <ArrowLeftRight className="h-3 w-3" />
              </button>
              <button onClick={clearLocation} className="text-muted-foreground/40 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setLocationPickerOpen(true)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Lier un lieu…
            </button>
          )}
        </div>
        {locationData && (locationData.city || locationData.district) && (
          <p className="text-xs text-muted-foreground pl-6">
            {[locationData.district, locationData.city].filter(Boolean).join(', ')}
          </p>
        )}
      </div>

      {/* Location images */}
      {locationImages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {locationImages.map(img => (
            <img
              key={img.id}
              src={img.url}
              alt={img.label || img.type}
              className="h-14 w-14 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLightboxImg(img)}
            />
          ))}
        </div>
      )}

      {/* Description */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ce qui se passe</p>
          {!suggestion && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={develop.isPending} onClick={() => develop.mutate()}>
              <Sparkles className="h-3 w-3 mr-1" />
              {develop.isPending ? 'Génération…' : 'Développer'}
            </Button>
          )}
        </div>
        {develop.isError && <p className="text-xs text-destructive">{(develop.error as Error).message}</p>}
        <MentionEditor
          campaignId={campaignId}
          value={local.description}
          onChange={v => handle('description', v)}
          placeholder="Décrivez la scène — ambiance, enjeux, déclencheur…"
        />
      </div>

      {/* Outcome */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dénouement possible</p>
        <AutoTextarea
          value={local.outcome}
          onChange={v => handle('outcome', v)}
          placeholder="Ce qui pourrait en résulter…"
        />
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</p>
        <AutoTextarea
          value={local.notes}
          onChange={v => handle('notes', v)}
          placeholder="Ambiance, météo, détails de décor, fun facts…"
        />
      </div>

      {suggestion && (
        <LLMSuggestionReview
          fields={SCENE_SUGGESTION_FIELDS}
          suggestion={suggestion}
          onAcceptField={acceptField}
          onRegenerate={regenerateFields}
          onDone={() => setSuggestion(null)}
        />
      )}

      {/* NPCs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PNJs présents</p>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setNpcPickerOpen(true)}>
            <Plus className="h-3 w-3 mr-0.5" /> Ajouter
          </Button>
        </div>
        {scene.npcs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun PNJ lié à cette scène.</p>
        ) : (
          <div className="space-y-2">
            {scene.npcs.map(npc => (
              <NPCCard key={npc.id} npc={npc} campaignId={campaignId} onRemove={() => removeNPC.mutate(npc.id)} onEdit={() => setEditNpcId(npc.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Artefacts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Artefacts</p>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setArtefactPickerOpen(true)}>
            <Plus className="h-3 w-3 mr-0.5" /> Ajouter
          </Button>
        </div>
        {scene.artefacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun artefact dans cette scène.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {scene.artefacts.map(a => {
              const imgs = (() => { try { return JSON.parse(a.images) || [] } catch { return [] } })()
              const cover = imgs[0]
              return (
                <div key={a.id} className="flex items-center gap-1 bg-muted/50 border rounded-md overflow-hidden pr-2 py-1 text-xs">
                  {cover
                    ? <img src={cover.url} alt={a.name} className="h-6 w-6 object-cover shrink-0" />
                    : <Package className="h-3 w-3 text-muted-foreground shrink-0 ml-2" />
                  }
                  <button className="hover:underline ml-1" onClick={() => setEditArtefactId(a.id)}>{a.name}</button>
                  <button onClick={() => removeArtefact.mutate(a.id)} className="text-muted-foreground/50 hover:text-destructive ml-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <LocationPicker
        campaignId={campaignId}
        open={locationPickerOpen}
        onClose={() => setLocationPickerOpen(false)}
        onPick={pickLocation}
      />
      {scene.location_id && (
        <LocationEditorModal
          locationId={scene.location_id}
          campaignId={campaignId}
          open={locationEditorOpen}
          onClose={() => setLocationEditorOpen(false)}
        />
      )}
      <NPCPicker
        campaignId={campaignId}
        open={npcPickerOpen}
        existingIds={scene.npcs.map(n => n.id)}
        onClose={() => setNpcPickerOpen(false)}
        onPick={npcId => addNPC.mutate(npcId)}
      />
      <ArtefactPicker
        campaignId={campaignId}
        open={artefactPickerOpen}
        existingIds={scene.artefacts.map(a => a.id)}
        onClose={() => setArtefactPickerOpen(false)}
        onPick={artefactId => addArtefact.mutate(artefactId)}
      />

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

      {editNpcId && (
        <NPCEditorModal
          npcId={editNpcId}
          campaignId={campaignId}
          open={!!editNpcId}
          onClose={() => setEditNpcId(null)}
        />
      )}
      {editArtefactId && (
        <ArtefactEditorModal
          artefactId={editArtefactId}
          campaignId={campaignId}
          open={!!editArtefactId}
          onClose={() => setEditArtefactId(null)}
        />
      )}

    </div>
  )
}
