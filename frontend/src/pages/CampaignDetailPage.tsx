import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { BookOpen, Download, Plus, Users, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import AppShell from '@/components/AppShell'
import { useDocTitle } from '@/hooks/useDocTitle'
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

function JoueursSection({ campaignId, ownerID }: { campaignId: string; ownerID: string }) {
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
    return role === 'superuser' ? 'Admin' : 'Joueur'
  }

  return (
    <div className="space-y-3 pt-6 border-t">
      <p className="text-sm font-medium">Joueurs</p>

      {members.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun joueur inscrit.</p>
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
          <p className="text-xs text-muted-foreground font-medium">Ajouter un joueur</p>
          <Input
            placeholder="Rechercher par nom ou email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          {filtered.length > 0 && (
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
          {search && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">Aucun utilisateur disponible.</p>
          )}
        </div>
      )}
    </div>
  )
}

interface FormState {
  name: string
  genre: string
  game_id: string
  lore: string
}

function initForm(c: Campaign): FormState {
  return { name: c.name, genre: c.genre, game_id: c.game_id, lore: c.lore }
}

function isDirty(form: FormState, c: Campaign): boolean {
  return (
    form.name !== c.name ||
    form.genre !== c.genre ||
    form.game_id !== c.game_id ||
    form.lore !== c.lore
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
        lore: f.lore,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['campaign', id], updated)
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

      {/* Lore global */}
      <div className="space-y-2">
        <Label htmlFor="lore">Lore global</Label>
        <p className="text-xs text-muted-foreground">
          Personnages récurrents, organisations, géographie, règles du monde. Markdown accepté.
        </p>
        <Textarea
          id="lore"
          placeholder="Le monde en quelques paragraphes…"
          value={form.lore}
          onChange={field('lore')}
          className="min-h-[200px] font-mono text-sm"
        />
      </div>

      {/* Scenario list */}
      <ScenarioList campaignId={id!} />

      {/* Joueurs */}
      <JoueursSection campaignId={id!} ownerID={campaign.owner_id} />
      {guardDialog}
    </form>
  )
}

function ScenarioList({ campaignId }: { campaignId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const { data: scenarios } = useQuery({
    queryKey: ['scenarios', campaignId],
    queryFn: () => api.get<Scenario[]>(`/campaigns/${campaignId}/scenarios`),
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

  const statusLabel: Record<string, string> = {
    draft: 'Brouillon',
    active: 'Actif',
    archived: 'Archivé',
  }

  return (
    <div className="space-y-3 pt-6 border-t">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Scénarios</p>
        <div className="flex gap-2">
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
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Nouveau scénario
          </Button>
        </div>
      </div>

      {scenarios && scenarios.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun scénario pour l'instant.</p>
      )}

      {scenarios && scenarios.length > 0 && (
        <ul className="space-y-1.5">
          {scenarios.map(s => (
            <li
              key={s.id}
              onClick={() => navigate(`/scenarios/${s.id}/synopsis`)}
              className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">{statusLabel[s.status] ?? s.status}</span>
            </li>
          ))}
        </ul>
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

  return (
    <AppShell crumbs={[{ label: campaign.name }]}>
      <main className="max-w-3xl mx-auto px-6 py-8">
        <CampaignForm campaign={campaign} />
      </main>
    </AppShell>
  )
}
