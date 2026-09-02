import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { BookOpen, Download, Plus, Users, Trash2, UserPlus, Wand2, ChevronDown, ChevronRight, GripVertical, Swords } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import AppShell from '@/components/AppShell'
import MentionEditor from '@/components/MentionEditor'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useSyncMode } from '@/hooks/useSyncMode'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import type { Scenario } from '@/types/scenario'
import type { Campaign } from '@/types/campaign'
import type { Game } from '@/types/game'

interface CampaignMember {
  id: string
  campaign_id: string
  user_id: string
  user_name: string
  user_email: string
  created_at: string
}

interface PublicUser {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

/**
 * Access control: which accounts can become Meneur de jeu for this campaign —
 * create and run their own groups, read what running one takes, but never
 * edit the authored material itself. Not the party — the people actually
 * seated at a table are a group's own affair, set up from the Meneur hub each
 * delegated account gets once granted access here. See
 * docs/adr/0001-runs-separate-story-from-play.md.
 */
function AccessSection({ campaignId, ownerID }: { campaignId: string; ownerID: string }) {
  const queryClient = useQueryClient()
  const currentUser = useUser()
  const isOwner = currentUser?.id === ownerID || currentUser?.role === 'superuser'

  const { data: members = [] } = useQuery({
    queryKey: ['campaign-members', campaignId],
    queryFn: () => api.get<CampaignMember[]>(`/campaigns/${campaignId}/members`),
  })

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<PublicUser[]>('/users'),
    enabled: isOwner,
  })

  const addMember = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/campaigns/${campaignId}/members`, { user_id: userId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaign-members', campaignId] }),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/campaigns/${campaignId}/members/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaign-members', campaignId] }),
  })

  const memberIds = new Set(members.map(m => m.user_id))
  const available = allUsers.filter(u => !memberIds.has(u.id))

  const [search, setSearch] = useState('')
  const filtered = available.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  function roleLabel(role: string) {
    return role === 'superuser' ? 'Admin' : 'Meneur de jeu'
  }

  return (
    <div className="space-y-3 pt-6 border-t">
      <div>
        <p className="text-sm font-medium">Accès</p>
        <p className="text-xs text-muted-foreground">
          Donne à un compte la possibilité de devenir meneur de jeu de cette
          campagne : créer ses propres groupes, les faire jouer, sans pouvoir
          modifier la campagne elle-même.
        </p>
      </div>

      <p className="text-xs text-muted-foreground font-medium">Comptes ayant accès</p>

      {members.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun meneur délégué.</p>
      )}

      {members.length > 0 && (
        <ul className="space-y-1">
          {members.map(m => (
            <li key={m.id} className="flex items-center gap-3 py-2 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.user_name}</p>
                <p className="text-xs text-muted-foreground truncate">{m.user_email}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                {new Date(m.created_at).toLocaleDateString('fr-FR')}
              </span>
              {isOwner && m.user_id !== ownerID && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeMember.mutate(m.user_id)}
                  disabled={removeMember.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner && available.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground font-medium">Donner accès à un compte</p>
          <Input
            placeholder="Rechercher par nom ou email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          {search.trim() && filtered.length > 0 && (
            <ul className="border rounded-md divide-y max-h-48 overflow-y-auto">
              {filtered.map(u => (
                <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{roleLabel(u.role)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0"
                    onClick={() => { addMember.mutate(u.id); setSearch('') }}
                    disabled={addMember.isPending}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">Aucun utilisateur disponible.</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Archiving pulls the campaign — and everything hanging off it: scenarios,
 * npcs, runs, sessions — out of the live schema into a JSON snapshot, rather
 * than flagging it in place or destroying it outright. See
 * db.ArchiveCampaign on the backend. One-way from this UI: there is no
 * restore action, only the downloadable snapshot on the archives page.
 */
function DangerZone({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState(false)

  const archive = useMutation({
    mutationFn: () => api.delete(`/campaigns/${campaignId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      navigate('/')
    },
  })

  return (
    <div className="space-y-3 pt-6 border-t">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-destructive"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Zone de danger
      </button>

      {expanded && (
        <>
          <p className="text-xs text-muted-foreground">
            Archiver retire la campagne — et tous ses scénarios, groupes et
            sessions — de la liste des campagnes actives. Une copie complète
            reste consultable et téléchargeable depuis les archives.
          </p>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            Archiver la campagne
          </Button>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archiver « {campaignName} » ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            La campagne, ses scénarios, groupes et sessions seront retirés de
            l'application et déplacés dans les archives. Cette action ne peut
            pas être annulée depuis l'interface.
          </p>
          {archive.error && (
            <p className="text-destructive text-sm">{archive.error.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
            >
              {archive.isPending ? 'Archivage…' : 'Archiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface FormState {
  name: string
  genre: string
  game_id: string
  pitch: string
}

function initForm(c: Campaign): FormState {
  return { name: c.name, genre: c.genre, game_id: c.game_id, pitch: c.pitch }
}

function isDirty(form: FormState, c: Campaign): boolean {
  return (
    form.name !== c.name ||
    form.genre !== c.genre ||
    form.game_id !== c.game_id ||
    form.pitch !== c.pitch
  )
}

/** Read-only mirror of CampaignForm for a delegated Meneur — see docs/users-authors.md §4. */
function CampaignOverviewReadOnly({ campaign }: { campaign: Campaign }) {
  const navigate = useNavigate()
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{campaign.name}</h1>
        <Button onClick={() => navigate(`/campaigns/${campaign.id}/runs`)}>
          Mener <Swords className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Jeu</p>
          <p className="text-sm">{campaign.game_name || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Genre</p>
          <p className="text-sm">{campaign.genre || '—'}</p>
        </div>
      </div>

      {campaign.pitch && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Pitch</p>
          <MentionEditor campaignId={campaign.id} value={campaign.pitch} onChange={() => {}} disabled />
        </div>
      )}
    </div>
  )
}

function CampaignForm({ campaign }: { campaign: Campaign }) {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => initForm(campaign))
  const dirty = isDirty(form, campaign)
  const { guardDialog } = useUnsavedGuard(dirty, async () => { await update.mutateAsync(form) })

  const { data: games = [] } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })

  const update = useMutation({
    mutationFn: (f: FormState) =>
      api.put<Campaign>(`/campaigns/${id}`, {
        name: f.name,
        genre: f.genre,
        game_id: f.game_id,
        pitch: f.pitch,
      }),
    onSuccess: (updated) => {
      // PUT's response doesn't carry read-only fields like `access` (only GET
      // does) — merge instead of replacing, or every other page sharing this
      // query key loses them from cache.
      queryClient.setQueryData<Campaign>(['campaign', id], old => old ? { ...old, ...updated } : updated)
      setForm(initForm(updated))
    },
  })

  function field(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }))
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); update.mutate(form) }}
      className="space-y-8"
    >
      {/* Header */}
      <div className="flex items-center justify-end gap-3">
        {update.error && (
          <p className="text-destructive text-sm">{update.error.message}</p>
        )}
        <Button
          type="submit"
          disabled={!dirty || update.isPending}
          variant={dirty ? 'default' : 'outline'}
        >
          {update.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}
        </Button>
      </div>

      {/* Campaign name */}
      <div className="space-y-2">
        <input
          className="text-3xl font-bold bg-transparent border-none outline-none w-full placeholder:text-muted-foreground/50 focus:ring-0"
          placeholder="Nom de la campagne"
          value={form.name}
          onChange={field('name')}
          required
        />
      </div>

      {/* Game + Genre */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="game_id">Jeu</Label>
          <select
            id="game_id"
            value={form.game_id}
            onChange={field('game_id')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">— Aucun jeu —</option>
            {games.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="genre">Genre</Label>
          <Input
            id="genre"
            placeholder="cyberpunk, fantasy, horror…"
            value={form.genre}
            onChange={field('genre')}
          />
        </div>
      </div>

      {/* Pitch */}
      <div className="space-y-2">
        <Label htmlFor="pitch">Pitch</Label>
        <MentionEditor
          campaignId={id!}
          value={form.pitch}
          onChange={v => setForm(f => ({ ...f, pitch: v }))}
          placeholder="Le pitch de la campagne… tapez @ pour citer un PNJ, un lieu, une faction"
          className="min-h-[100px]"
        />
      </div>

      {/* Scenario list */}
      <ScenarioList campaignId={id!} />

      {/* Who may open the campaign */}
      <AccessSection campaignId={id!} ownerID={campaign.owner_id} />

      <DangerZone campaignId={id!} campaignName={campaign.name} />
      {guardDialog}
    </form>
  )
}

const scenarioStatusLabel: Record<string, string> = {
  draft: 'Brouillon',
  active: 'Actif',
  archived: 'Archivé',
}

function ScenarioRowReadOnly({ scenario, onOpen }: { scenario: Scenario; onOpen: () => void }) {
  return (
    <li
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="flex-1 text-sm font-medium">{scenario.name}</span>
      <span className="text-xs text-muted-foreground">{scenarioStatusLabel[scenario.status] ?? scenario.status}</span>
    </li>
  )
}

function ScenarioRow({ scenario, onOpen }: { scenario: Scenario; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: scenario.id })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <button
        type="button"
        className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
        onClick={e => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="flex-1 text-sm font-medium">{scenario.name}</span>
      <span className="text-xs text-muted-foreground">{scenarioStatusLabel[scenario.status] ?? scenario.status}</span>
    </li>
  )
}

function ScenarioList({ campaignId, readOnly = false }: { campaignId: string; readOnly?: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const { data: scenarios } = useQuery({
    queryKey: ['scenarios', campaignId],
    queryFn: () => api.get<Scenario[]>(`/campaigns/${campaignId}/scenarios`),
  })

  const active = (scenarios ?? []).filter(s => s.status !== 'archived')
  const archived = [...(scenarios ?? []).filter(s => s.status === 'archived')]
    .sort((a, b) => {
      if (!a.archived_at && !b.archived_at) return 0
      if (!a.archived_at) return 1
      if (!b.archived_at) return -1
      return b.archived_at.localeCompare(a.archived_at)
    })

  const create = useMutation({
    mutationFn: (n: string) =>
      api.post<Scenario>(`/campaigns/${campaignId}/scenarios`, { name: n }),
    onSuccess: (scenario) => {
      queryClient.invalidateQueries({ queryKey: ['scenarios', campaignId] })
      setOpen(false)
      setName('')
      navigate(`/scenarios/${scenario.id}/synopsis`)
    },
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<Scenario[]>(`/campaigns/${campaignId}/scenarios/reorder`, { ids }),
    onSuccess: (data) => queryClient.setQueryData(['scenarios', campaignId], data),
  })

  function onDragEnd(event: DragEndEvent) {
    const { active: draggedItem, over } = event
    if (!over || draggedItem.id === over.id) return
    const oldIndex = active.findIndex(s => s.id === draggedItem.id)
    const newIndex = active.findIndex(s => s.id === over.id)
    const reordered = arrayMove(active, oldIndex, newIndex)
    queryClient.setQueryData(['scenarios', campaignId], [...reordered, ...archived])
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => reorder.mutate(reordered.map(s => s.id)), 400)
  }

  return (
    <div className="space-y-3 pt-6 border-t">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-medium">Scénarios</p>
        <div className="flex gap-2 flex-wrap">
          <a
            href={`/api/campaigns/${campaignId}/export`}
            className="inline-flex items-center gap-1 text-xs h-8 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </a>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/entities`)}>
            <Users className="h-3.5 w-3.5 mr-1" />
            Entités
          </Button>
          {!readOnly && (
            <>
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nouveau scénario
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate(`/campaigns/${campaignId}/factory`)}>
                <Wand2 className="h-3.5 w-3.5 mr-1" />
                Fabrique
              </Button>
            </>
          )}
        </div>
      </div>

      {scenarios && scenarios.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun scénario pour l'instant.</p>
      )}

      {active.length > 0 && readOnly && (
        <ul className="space-y-1.5">
          {active.map(s => (
            <ScenarioRowReadOnly key={s.id} scenario={s} onOpen={() => navigate(`/scenarios/${s.id}/synopsis`)} />
          ))}
        </ul>
      )}

      {active.length > 0 && !readOnly && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={active.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {active.map(s => (
                <ScenarioRow key={s.id} scenario={s} onOpen={() => navigate(`/scenarios/${s.id}/synopsis`)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {archived.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <p className="text-xs text-muted-foreground">Archivés</p>
          <ul className="space-y-1.5">
            {archived.map(s => (
              <li
                key={s.id}
                onClick={() => navigate(`/scenarios/${s.id}/synopsis`)}
                className="flex items-center gap-3 p-3 rounded-md border bg-muted/40 hover:bg-accent/50 transition-colors cursor-pointer text-muted-foreground"
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                <span className="text-xs">{scenarioStatusLabel[s.status] ?? s.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau scénario</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()) }}
            className="space-y-4 mt-2"
          >
            <Input
              placeholder="Ex : L'Affaire du Prototype"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            {create.error && (
              <p className="text-destructive text-sm">{create.error.message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending ? 'Création…' : 'Créer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get<Campaign>(`/campaigns/${id}`),
  })

  useDocTitle(campaign ? `lore: ${campaign.name}` : 'lore')

  // Writing is owner-only, but a delegated Meneur can still browse the
  // material read-only — the story and cast they need before deciding to run
  // a session. See docs/users-authors.md §4.
  const isNonOwner = campaign != null && campaign.access !== 'owner'
  useSyncMode(isNonOwner ? 'gamemaster' : 'author')

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground text-sm">Chargement…</p>
        </div>
      </AppShell>
    )
  }

  if (error || !campaign) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <p className="text-destructive text-sm">{error?.message ?? 'Campagne introuvable'}</p>
          <Button variant="outline" onClick={() => navigate('/')}>Retour aux campagnes</Button>
        </div>
      </AppShell>
    )
  }

  if (isNonOwner) {
    return (
      <AppShell crumbs={[{ label: campaign.name }]}>
        <main className="max-w-3xl mx-auto px-6 py-8">
          <CampaignOverviewReadOnly campaign={campaign} />
          <ScenarioList campaignId={id!} readOnly />
          <AccessSection campaignId={id!} ownerID={campaign.owner_id} />
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell crumbs={[{ label: campaign.name }]}>
      <main className="max-w-3xl mx-auto px-6 py-8">
        <CampaignForm key={campaign.id} campaign={campaign} />
      </main>
    </AppShell>
  )
}
