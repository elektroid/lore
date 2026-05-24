import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Play, Flag, CheckCircle2, XCircle, Circle, MapPin, Users,
  Plus, Pencil, Trash2, ChevronDown, ArrowLeft, UserPlus,
} from 'lucide-react'
import AppShell from '@/components/AppShell'
import { useDocTitle } from '@/hooks/useDocTitle'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Scenario } from '@/types/scenario'
import type { Campaign } from '@/types/campaign'
import type { Scene, SceneNPC } from '@/types/synopsis'
import type { CampaignLocation, NPCImage, LocationImage } from '@/types/entities'
import type { Session, SessionPlayer, MemberWithCharacters, ScenePlayState } from '@/types/session'

// ── Scene state display ───────────────────────────────────────────────────────

const STATE_CONFIG = {
  pending: { icon: Circle,       cls: 'text-muted-foreground/40',  label: 'En attente' },
  cleared: { icon: CheckCircle2, cls: 'text-emerald-500',           label: 'Jouée' },
  void:    { icon: XCircle,      cls: 'text-muted-foreground/40',  label: 'Annulée' },
} as const

function nextState(current: ScenePlayState): ScenePlayState {
  if (current === 'pending') return 'cleared'
  if (current === 'cleared') return 'void'
  return 'pending'
}

// ── Session form modal (name + date only) ────────────────────────────────────

function SessionModal({
  session, onClose, onSave,
}: {
  session: Session | null
  onClose: () => void
  onSave: (data: { name: string; date: string }) => void
}) {
  const [name, setName] = useState(session?.name ?? '')
  const [date, setDate] = useState(session?.date ?? new Date().toISOString().slice(0, 10))

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{session ? 'Modifier la session' : 'Nouvelle session'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nom</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="La nuit du Prototype" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Date</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), date })}>
            {session ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Roster dialog ─────────────────────────────────────────────────────────────

function RosterDialog({
  scenarioId, sessionId, campaignId, onClose,
}: {
  scenarioId: string
  sessionId: string
  campaignId: string
  onClose: () => void
}) {
  const qc = useQueryClient()

  const { data: sessionPlayers = [] } = useQuery({
    queryKey: ['session-players', sessionId],
    queryFn: () => api.get<SessionPlayer[]>(`/scenarios/${scenarioId}/sessions/${sessionId}/players`),
  })

  const { data: memberCharacters = [] } = useQuery({
    queryKey: ['member-characters', campaignId],
    queryFn: () => api.get<MemberWithCharacters[]>(`/campaigns/${campaignId}/members/characters`),
  })

  const enrolledIds = new Set(sessionPlayers.map(p => p.user_id))
  const available = memberCharacters.filter(m => !enrolledIds.has(m.user_id))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['session-players', sessionId] })

  const addPlayer = useMutation({
    mutationFn: (userId: string) =>
      api.put(`/scenarios/${scenarioId}/sessions/${sessionId}/players/${userId}`, { character_id: '' }),
    onSuccess: invalidate,
  })

  const removePlayer = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/scenarios/${scenarioId}/sessions/${sessionId}/players/${userId}`),
    onSuccess: invalidate,
  })

  const assignCharacter = useMutation({
    mutationFn: ({ userId, characterId }: { userId: string; characterId: string }) =>
      api.put(`/scenarios/${scenarioId}/sessions/${sessionId}/players/${userId}`, { character_id: characterId }),
    onSuccess: invalidate,
  })

  function charactersFor(userId: string) {
    return memberCharacters.find(m => m.user_id === userId)?.characters ?? []
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Joueurs de la session</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Enrolled players */}
          {sessionPlayers.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Aucun joueur dans cette session.</p>
          )}
          {sessionPlayers.length > 0 && (
            <ul className="space-y-2">
              {sessionPlayers.map(p => {
                const chars = charactersFor(p.user_id)
                return (
                  <li key={p.user_id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.user_name}</p>
                      {chars.length > 0 ? (
                        <select
                          value={p.character_id}
                          onChange={e => assignCharacter.mutate({ userId: p.user_id, characterId: e.target.value })}
                          className="mt-0.5 w-full text-xs rounded border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring text-muted-foreground"
                        >
                          <option value="">— Aucun personnage —</option>
                          {chars.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.character_name || <span className="italic">Aucun personnage disponible</span>}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removePlayer.mutate(p.user_id)}
                      disabled={removePlayer.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Available members to add */}
          {available.length > 0 && (
            <div className="pt-3 border-t space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Ajouter un joueur</p>
              <ul className="space-y-1">
                {available.map(m => (
                  <li key={m.user_id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm truncate">{m.user_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{m.user_email}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => addPlayer.mutate(m.user_id)}
                      disabled={addPlayer.isPending}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {available.length === 0 && sessionPlayers.length > 0 && memberCharacters.length > 0 && (
            <p className="text-xs text-muted-foreground italic pt-2 border-t">
              Tous les joueurs inscrits sont dans cette session.
            </p>
          )}

          {memberCharacters.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Aucun joueur inscrit à cette campagne. Ajoutez-en depuis la page de la campagne.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Scene row (play mode) ─────────────────────────────────────────────────────

function PlaySceneRow({
  scene, state, selected, isActive, onSelect, onCycle,
}: {
  scene: Scene
  state: ScenePlayState
  selected: boolean
  isActive: boolean
  onSelect: () => void
  onCycle: () => void
}) {
  const { icon: Icon, cls } = STATE_CONFIG[state]

  if (scene.type === 'divider') {
    return (
      <li className="flex items-center gap-2 py-1 px-1">
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        {scene.title && <span className="text-xs text-muted-foreground/60 shrink-0">{scene.title}</span>}
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
      </li>
    )
  }

  return (
    <li
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-md border px-2 py-2 cursor-pointer transition-colors ${
        selected
          ? 'bg-accent border-accent-foreground/20'
          : state === 'void'
            ? 'bg-muted/30 border-transparent opacity-50'
            : state === 'cleared'
              ? 'bg-muted/20 border-transparent'
              : 'bg-card border-border hover:bg-accent/50'
      }`}
    >
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onCycle() }}
        className={`shrink-0 transition-colors hover:opacity-80 ${cls}`}
        title={STATE_CONFIG[state].label}
      >
        <Icon className="h-4 w-4" />
      </button>

      <span className={`flex-1 text-sm truncate ${state === 'void' ? 'line-through' : ''}`}>
        {scene.title || <span className="italic text-muted-foreground">Sans titre</span>}
      </span>

      {scene.is_start && <Play className="h-3 w-3 shrink-0 text-emerald-500" />}
      {scene.is_end && <Flag className="h-3 w-3 shrink-0 text-rose-400" />}
      {isActive && (
        <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Scène active" />
      )}
    </li>
  )
}

// ── NPC detail dialog ─────────────────────────────────────────────────────────

function NpcDetailDialog({ npc, onClose }: { npc: SceneNPC; onClose: () => void }) {
  const images: NPCImage[] = (() => { try { return JSON.parse(npc.images) || [] } catch { return [] } })()
  const cover = images[0]

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{npc.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          {cover && (
            <img
              src={cover.url}
              alt={cover.label || npc.name}
              className="w-full h-40 object-cover rounded-md"
            />
          )}
          {npc.role && (
            <p className="text-xs text-muted-foreground italic">{npc.role}</p>
          )}
          {npc.description && (
            <div className="space-y-0.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{npc.description}</p>
            </div>
          )}
          {npc.motivation && (
            <div className="space-y-0.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motivation</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{npc.motivation}</p>
            </div>
          )}
          {npc.quote && (
            <blockquote className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
              "{npc.quote}"
            </blockquote>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Location detail dialog ────────────────────────────────────────────────────

function LocationDetailDialog({
  locationId, campaignId, onClose,
}: { locationId: string; campaignId: string; onClose: () => void }) {
  const { data: location, isLoading } = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => api.get<CampaignLocation>(`/campaigns/${campaignId}/locations/${locationId}`),
    enabled: !!locationId && !!campaignId,
  })

  const images: LocationImage[] = (() => { try { return JSON.parse(location?.images ?? '[]') || [] } catch { return [] } })()
  const cover = images[0]

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isLoading ? '…' : location?.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Chargement…</p>
        ) : location ? (
          <div className="space-y-3 mt-1">
            {cover && (
              <img
                src={cover.url}
                alt={cover.label || location.name}
                className="w-full h-40 object-cover rounded-md"
              />
            )}
            {(location.city || location.district) && (
              <p className="text-xs text-muted-foreground">
                {[location.district, location.city].filter(Boolean).join(', ')}
              </p>
            )}
            {location.description && (
              <div className="space-y-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{location.description}</p>
              </div>
            )}
            {location.atmosphere && (
              <div className="space-y-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atmosphère</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{location.atmosphere}</p>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ── Play scene detail (read-only) ─────────────────────────────────────────────

function PlayScenePanel({ scene, campaignId }: { scene: Scene; campaignId: string }) {
  const [selectedNpc, setSelectedNpc] = useState<SceneNPC | null>(null)
  const [locationOpen, setLocationOpen] = useState(false)

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-semibold flex-1">{scene.title || <span className="italic text-muted-foreground">Sans titre</span>}</h2>
        {scene.is_start && <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"><Play className="h-3 w-3" />Départ</span>}
        {scene.is_end && <span className="inline-flex items-center gap-1 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5"><Flag className="h-3 w-3" />Fin</span>}
      </div>
      {scene.location_name && (
        <button
          onClick={() => scene.location_id && setLocationOpen(true)}
          className={`flex items-center gap-1.5 text-sm text-muted-foreground ${scene.location_id ? 'hover:text-foreground transition-colors cursor-pointer underline-offset-2 hover:underline' : ''}`}
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {scene.location_name}
        </button>
      )}
      {scene.description && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{scene.description}</p>
        </div>
      )}
      {scene.outcome && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dénouement</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{scene.outcome}</p>
        </div>
      )}
      {scene.notes && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes MJ</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{scene.notes}</p>
        </div>
      )}
      {scene.npcs.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PNJs</p>
          <div className="flex flex-wrap gap-1.5">
            {scene.npcs.map(n => (
              <button
                key={n.id}
                onClick={() => setSelectedNpc(n)}
                className="text-xs bg-muted rounded px-2 py-0.5 hover:bg-accent transition-colors cursor-pointer"
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {scene.artefacts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artefacts</p>
          <div className="flex flex-wrap gap-1.5">
            {scene.artefacts.map(a => {
              const imgs = (() => { try { return JSON.parse(a.images) || [] } catch { return [] } })()
              const cover = imgs[0]
              return (
                <span key={a.id} className="flex items-center gap-1 text-xs bg-muted rounded overflow-hidden pr-2">
                  {cover && <img src={cover.url} alt={a.name} className="h-5 w-5 object-cover shrink-0" />}
                  <span className={cover ? '' : 'px-2 py-0.5'}>{a.name}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>

    {selectedNpc && (
      <NpcDetailDialog npc={selectedNpc} onClose={() => setSelectedNpc(null)} />
    )}
    {locationOpen && scene.location_id && (
      <LocationDetailDialog
        locationId={scene.location_id}
        campaignId={campaignId}
        onClose={() => setLocationOpen(false)}
      />
    )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PlayPage() {
  const { id } = useParams<{ id: string }>()
  const scenarioId = id!
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [selectedSceneId, setSelectedSceneId] = useState('')
  const [sessionModalOpen, setSessionModalOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)

  const { data: scenario } = useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => api.get<Scenario>(`/scenarios/${scenarioId}`),
  })

  const { data: campaign } = useQuery({
    queryKey: ['campaign', scenario?.campaign_id],
    queryFn: () => api.get<Campaign>(`/campaigns/${scenario!.campaign_id}`),
    enabled: !!scenario?.campaign_id,
  })

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions', scenarioId],
    queryFn: () => api.get<Session[]>(`/scenarios/${scenarioId}/sessions`),
  })

  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? sessions[0] ?? null

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId])

  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', scenarioId],
    queryFn: () => api.get<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes`),
  })

  const { data: sceneStates = {} } = useQuery({
    queryKey: ['session-scenes', activeSession?.id],
    queryFn: () => api.get<Record<string, 'cleared' | 'void'>>(`/scenarios/${scenarioId}/sessions/${activeSession!.id}/scenes`),
    enabled: !!activeSession?.id,
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['campaign-locations', scenario?.campaign_id],
    queryFn: () => api.get<CampaignLocation[]>(`/campaigns/${scenario!.campaign_id}/locations`),
    enabled: !!scenario?.campaign_id && locationPickerOpen,
  })

  const { data: sessionPlayers = [] } = useQuery({
    queryKey: ['session-players', activeSession?.id],
    queryFn: () => api.get<SessionPlayer[]>(`/scenarios/${scenarioId}/sessions/${activeSession!.id}/players`),
    enabled: !!activeSession?.id,
  })

  useDocTitle(scenario ? `lore: ${scenario.name} — Play` : 'lore')

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createSession = useMutation({
    mutationFn: (data: { name: string; date: string }) =>
      api.post<Session>(`/scenarios/${scenarioId}/sessions`, data),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['sessions', scenarioId] })
      setActiveSessionId(s.id)
      setSessionModalOpen(false)
      setRosterOpen(true)
    },
  })

  const updateSession = useMutation({
    mutationFn: (data: Partial<Session>) =>
      api.put<Session>(`/scenarios/${scenarioId}/sessions/${activeSession!.id}`, data),
    onSuccess: (s) => {
      qc.setQueryData(['sessions', scenarioId], (old: Session[] = []) =>
        old.map(x => x.id === s.id ? s : x))
      setSessionModalOpen(false)
      setEditingSession(null)
    },
  })

  const deleteSession = useMutation({
    mutationFn: (id: string) => api.delete(`/scenarios/${scenarioId}/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions', scenarioId] })
      setActiveSessionId('')
    },
  })

  const cycleSceneState = useMutation({
    mutationFn: async ({ scene, current }: { scene: Scene; current: ScenePlayState }) => {
      const next = nextState(current)
      if (next === 'pending') {
        await api.delete(`/scenarios/${scenarioId}/sessions/${activeSession!.id}/scenes/${scene.id}`)
      } else {
        await api.put(`/scenarios/${scenarioId}/sessions/${activeSession!.id}/scenes/${scene.id}`, { state: next })
      }

      const newActive = next === 'cleared' ? scene.id : (activeSession!.active_scene_id === scene.id ? '' : activeSession!.active_scene_id)
      await api.put<Session>(`/scenarios/${scenarioId}/sessions/${activeSession!.id}`, {
        ...activeSession,
        active_scene_id: newActive,
      })
      return next
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-scenes', activeSession?.id] })
      qc.invalidateQueries({ queryKey: ['sessions', scenarioId] })
    },
  })

  const setActiveLocation = useMutation({
    mutationFn: (locationId: string) =>
      api.put<Session>(`/scenarios/${scenarioId}/sessions/${activeSession!.id}`, {
        ...activeSession,
        active_location_id: locationId,
      }),
    onSuccess: (s) => {
      qc.setQueryData(['sessions', scenarioId], (old: Session[] = []) =>
        old.map(x => x.id === s.id ? s : x))
      setLocationPickerOpen(false)
    },
  })

  const activeSceneObj = scenes.find(s => s.id === activeSession?.active_scene_id) ?? null
  const selectedScene = scenes.find(s => s.id === selectedSceneId) ?? null
  const activeLocation = locations.find(l => l.id === activeSession?.active_location_id)

  function handleSessionSave(data: { name: string; date: string }) {
    if (editingSession) {
      updateSession.mutate({ ...editingSession, ...data })
    } else {
      createSession.mutate(data)
    }
  }

  return (
    <>
    <AppShell
      crumbs={[
        { label: campaign?.name ?? '…', to: campaign ? `/campaigns/${campaign.id}` : undefined },
        { label: scenario?.name ?? '…', onClick: () => navigate(`/scenarios/${scenarioId}/synopsis`) },
        { label: 'Play' },
      ]}
    >
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">

        {/* ── Top bar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Session selector */}
          <div className="flex items-center gap-2">
            {sessions.length > 0 ? (
              <select
                value={activeSession?.id ?? ''}
                onChange={e => setActiveSessionId(e.target.value)}
                className="text-sm rounded border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.date ? ` — ${s.date}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-muted-foreground">Aucune session</span>
            )}
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs"
              onClick={() => { setEditingSession(null); setSessionModalOpen(true) }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {activeSession && (
              <>
                <Button size="sm" variant="ghost" className="h-8 px-2"
                  onClick={() => { setEditingSession(activeSession); setSessionModalOpen(true) }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive"
                  onClick={() => { if (confirm('Supprimer cette session ?')) deleteSession.mutate(activeSession.id) }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>

          {/* Active location */}
          {activeSession && (
            <button
              onClick={() => setLocationPickerOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-border hover:bg-accent transition-colors"
            >
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              {activeLocation ? activeLocation.name : <span className="text-muted-foreground">Lieu actif…</span>}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          )}

          {/* Players */}
          {activeSession && (
            <button
              onClick={() => setRosterOpen(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-border hover:bg-accent transition-colors"
              title="Gérer les joueurs"
            >
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              {sessionPlayers.length === 0
                ? <span className="text-muted-foreground">Joueurs…</span>
                : sessionPlayers.map(p => p.character_name || p.user_name).join(', ')
              }
            </button>
          )}

          <div className="ml-auto">
            <a href={`/scenarios/${scenarioId}/synopsis`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Mode édition
            </a>
          </div>
        </div>

        {/* Location picker dropdown */}
        {locationPickerOpen && (
          <div className="rounded-md border bg-popover shadow-md p-2 space-y-1 max-h-48 overflow-y-auto">
            <button
              className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground"
              onClick={() => { setActiveLocation.mutate(''); setLocationPickerOpen(false) }}
            >
              Aucun lieu
            </button>
            {locations.map(l => (
              <button key={l.id}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent"
                onClick={() => setActiveLocation.mutate(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
        )}

        {/* Active scene shortcut */}
        {activeSceneObj && activeSceneObj.id !== selectedSceneId && (
          <button
            onClick={() => setSelectedSceneId(activeSceneObj.id)}
            className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            <span className="font-medium">Scène active :</span>
            <span className="truncate">{activeSceneObj.title || 'Sans titre'}</span>
            <span className="ml-auto text-muted-foreground">→</span>
          </button>
        )}

        {/* ── Main split ─────────────────────────────────────────────── */}
        {!activeSession ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
            <p className="text-muted-foreground text-sm">Créez une session pour commencer à jouer.</p>
            <Button onClick={() => { setEditingSession(null); setSessionModalOpen(true) }}>
              <Plus className="h-4 w-4 mr-1.5" />
              Nouvelle session
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[280px_1fr] gap-6 min-h-[60vh]">

            {/* Left — scene list */}
            <div className="rounded-lg border bg-card p-4 flex flex-col">
              <h3 className="text-sm font-semibold mb-3">Scènes</h3>
              <ul className="space-y-1 flex-1 overflow-y-auto">
                {scenes.map(scene => (
                  <PlaySceneRow
                    key={scene.id}
                    scene={scene}
                    state={(sceneStates[scene.id] as ScenePlayState) ?? 'pending'}
                    selected={selectedSceneId === scene.id}
                    isActive={activeSession.active_scene_id === scene.id}
                    onSelect={() => setSelectedSceneId(prev => prev === scene.id ? '' : scene.id)}
                    onCycle={() => cycleSceneState.mutate({
                      scene,
                      current: (sceneStates[scene.id] as ScenePlayState) ?? 'pending',
                    })}
                  />
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                Cliquez sur l'icône pour changer l'état d'une scène.
              </p>
            </div>

            {/* Right — detail */}
            <div className="rounded-lg border bg-card p-4 overflow-y-auto max-h-[80vh]">
              {selectedScene ? (
                <PlayScenePanel scene={selectedScene} campaignId={scenario?.campaign_id ?? ''} />
              ) : (
                <p className="text-muted-foreground text-sm">Sélectionnez une scène.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>

    {/* Session modal */}
    {sessionModalOpen && (
      <SessionModal
        session={editingSession}
        onClose={() => { setSessionModalOpen(false); setEditingSession(null) }}
        onSave={handleSessionSave}
      />
    )}

    {/* Roster dialog */}
    {rosterOpen && activeSession && scenario?.campaign_id && (
      <RosterDialog
        scenarioId={scenarioId}
        sessionId={activeSession.id}
        campaignId={scenario.campaign_id}
        onClose={() => setRosterOpen(false)}
      />
    )}
    </>
  )
}
