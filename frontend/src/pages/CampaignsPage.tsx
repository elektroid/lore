import { useRef, useState } from 'react'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import EntityAvatar from '@/components/EntityAvatar'
import CharacterEditorModal from '@/components/CharacterEditorModal'
import ModePicker from '@/components/ModePicker'
import { useModeStore } from '@/stores/mode'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { Campaign } from '@/types/campaign'
import type { Game } from '@/types/game'
import type { CreateCharacterRequest, ListCharactersResponse, PlayerCharacter } from '@/types/character'
import type { ListPlayerRunsResponse } from '@/types/me'

// ── Author dashboard ─────────────────────────────────────────────────────────

interface CampaignForm {
  name: string
  genre: string
  game_id: string
}

const emptyForm: CampaignForm = { name: '', genre: '', game_id: '' }

function AuthorDashboard({ campaigns }: { campaigns: Campaign[] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CampaignForm>(emptyForm)
  const [genreTouched, setGenreTouched] = useState(false)

  const { data: games = [] } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })

  const create = useMutation({
    mutationFn: (data: CampaignForm) => api.post<Campaign>('/campaigns', data),
    onSuccess: (campaign) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      setOpen(false)
      setForm(emptyForm)
      setGenreTouched(false)
      navigate(`/campaigns/${campaign.id}`)
    },
  })

  const importInputRef = useRef<HTMLInputElement>(null)
  const importCampaign = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload<Campaign>('/campaigns/import', form)
    },
    onSuccess: (campaign) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${campaign.id}`)
    },
  })

  function field(key: keyof CampaignForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }))
  }

  function handleGenreChange(e: React.ChangeEvent<HTMLInputElement>) {
    setGenreTouched(true)
    setForm(f => ({ ...f, genre: e.target.value }))
  }

  function handleGameChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const gameId = e.target.value
    const game = games.find(g => g.id === gameId)
    setForm(f => ({
      ...f,
      game_id: gameId,
      genre: !genreTouched && game ? game.genre : f.genre,
    }))
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Campagnes</h2>
        <div className="flex items-center gap-2">
          <Link
            to="/campaigns/archives"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Archives
          </Link>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) importCampaign.mutate(file)
            }}
          />
          <Button
            variant="outline"
            disabled={importCampaign.isPending}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            {importCampaign.isPending ? 'Import…' : 'Importer'}
          </Button>
          <Button onClick={() => setOpen(true)}>Nouvelle campagne</Button>
        </div>
      </div>

      {importCampaign.isError && (
        <p className="text-destructive text-sm mb-4">
          {(importCampaign.error as Error).message}
        </p>
      )}

      {campaigns.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Aucune campagne pour l'instant. Créez-en une pour commencer.
        </p>
      )}

      {campaigns.length > 0 && (
        <ul className="space-y-2">
          {campaigns.map(c => (
            <li
              key={c.id}
              onClick={() => navigate(`/campaigns/${c.id}`)}
              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <div>
                <p className="font-medium">{c.name}</p>
                {c.genre && <p className="text-sm text-muted-foreground">{c.genre}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(c.updated_at).toLocaleDateString('fr-FR')}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle campagne</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={e => { e.preventDefault(); if (form.name.trim()) create.mutate(form) }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Nom *</Label>
              <Input
                id="name"
                placeholder="Ex : Neon Requiem"
                value={form.name}
                onChange={field('name')}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="game_id">Jeu</Label>
              <select
                id="game_id"
                value={form.game_id}
                onChange={handleGameChange}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— Aucun jeu / autre —</option>
                {games.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              {games.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucun jeu configuré. <Link to="/games" className="underline hover:text-foreground">Ajoutez-en un</Link>.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="genre">Genre</Label>
              <Input
                id="genre"
                placeholder="Ex : cyberpunk, fantasy, horreur…"
                value={form.genre}
                onChange={handleGenreChange}
              />
              <p className="text-xs text-muted-foreground">
                Rempli automatiquement d'après le jeu choisi — modifiez-le si l'histoire s'en écarte.
              </p>
            </div>
            {create.error && (
              <p className="text-destructive text-sm">{create.error.message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={!form.name.trim() || create.isPending}>
                {create.isPending ? 'Création…' : 'Créer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Gamemaster dashboard ─────────────────────────────────────────────────────
//
// Every campaign this account can run a table for — owned (write access) and
// delegated (access === 'member', see docs/users-authors.md §4 "the
// delegated Meneur"). Unlike AuthorDashboard, rows open the Meneur console
// directly (/campaigns/:id/runs) rather than the authoring page, and there
// is no "create campaign" here — creating is an authoring action.

function GamemasterDashboard({ campaigns }: { campaigns: Campaign[] }) {
  const navigate = useNavigate()

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Mener une table</h2>
      {campaigns.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucune campagne accessible pour l'instant.
        </p>
      ) : (
        <ul className="space-y-2">
          {campaigns.map(c => (
            <li
              key={c.id}
              onClick={() => navigate(`/campaigns/${c.id}/runs`)}
              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <div>
                <p className="font-medium">{c.name}</p>
                {c.genre && <p className="text-sm text-muted-foreground">{c.genre}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                {c.access === 'member' ? 'Délégué' : 'Auteur'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Player: your tables ─────────────────────────────────────────────────────

/**
 * Runs the account is seated in, plus campaigns it merely has access to but
 * isn't seated in yet — access and a seat are different questions
 * (campaign_members vs run_players). See docs/adr/0001-runs-separate-story-from-play.md.
 */
function TablesView({ memberCampaigns }: { memberCampaigns: Campaign[] }) {
  const navigate = useNavigate()

  const { data: runsResp } = useQuery({
    queryKey: ['me-runs'],
    queryFn: () => api.get<ListPlayerRunsResponse>('/me/runs'),
  })
  const runs = runsResp?.runs ?? []

  const seatedCampaignIds = new Set(runs.map(r => r.campaign_id))
  const waitingForSeat = memberCampaigns.filter(c => !seatedCampaignIds.has(c.id))

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Vos tables</h2>
      {runs.length === 0 && waitingForSeat.length === 0 ? (
        <p className="text-muted-foreground text-sm">Vous ne jouez dans aucune table pour l'instant.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map(r => (
            <li
              key={r.run_id}
              onClick={() => navigate(`/runs/${r.run_id}`)}
              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <div>
                <p className="font-medium">{r.run_name}</p>
                <p className="text-sm text-muted-foreground">
                  {r.campaign_name}
                  {r.character_name && ` · ${r.character_name}`}
                </p>
              </div>
              {r.last_session_date && (
                <p className="text-xs text-muted-foreground">{r.last_session_date}</p>
              )}
            </li>
          ))}
          {waitingForSeat.map(c => (
            <li key={c.id} className="flex items-center justify-between p-4 rounded-lg border border-dashed bg-transparent">
              <div>
                <p className="font-medium text-muted-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">Accès accordé, en attente d'un groupe</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CharactersView() {
  const qc = useQueryClient()
  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => api.get<ListCharactersResponse>('/characters').then(r => r.characters),
  })
  const { data: games = [] } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGameId, setNewGameId] = useState('')
  const [editId, setEditId] = useState<string | null>(null)

  const createCharacter = useMutation({
    mutationFn: (data: Pick<CreateCharacterRequest, 'name' | 'game_id'>) =>
      api.post<PlayerCharacter>('/characters', { ...data, description: '', personal_story: '', sheet: '{}' }),
    onSuccess: (char) => {
      qc.invalidateQueries({ queryKey: ['characters'] })
      setCreating(false)
      setNewName('')
      setNewGameId('')
      setEditId(char.id)
    },
  })

  const deleteCharacter = useMutation({
    mutationFn: (id: string) => api.delete(`/characters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters'] }),
  })

  // Group characters by game_name
  const byGame = characters.reduce<Record<string, PlayerCharacter[]>>((acc, c) => {
    const key = c.game_name || 'Jeu inconnu'
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Mes personnages</h2>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Nouveau personnage
        </Button>
      </div>
      {characters.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aucun personnage pour l'instant.</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(byGame).map(([gameName, chars]) => (
            <div key={gameName}>
              <p className="text-sm font-medium text-muted-foreground mb-2">{gameName}</p>
              <ul className="space-y-2">
                {chars.map(c => (
                  <li key={c.id} className="flex items-start gap-3 p-4 rounded-lg border bg-card group">
                    <EntityAvatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <button
                        className="text-sm font-medium truncate hover:underline text-left"
                        onClick={() => setEditId(c.id)}
                      >
                        {c.name || <span className="text-muted-foreground italic">(sans nom)</span>}
                      </button>
                      {c.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{c.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditId(c.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => { if (confirm(`Supprimer "${c.name}" ?`)) deleteCharacter.mutate(c.id) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={o => !o && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau personnage</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nom</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom du personnage" autoFocus />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Jeu</Label>
              <select
                value={newGameId}
                onChange={e => setNewGameId(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">—</option>
                {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!newName.trim() || !newGameId || createCharacter.isPending}
              onClick={() => createCharacter.mutate({ name: newName.trim(), game_id: newGameId })}
            >
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editId && (
        <CharacterEditorModal characterId={editId} open={!!editId} onClose={() => setEditId(null)} />
      )}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  useDocTitle('lore')
  const mode = useModeStore(s => s.mode)

  const { data: campaigns = [], isLoading, error } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<Campaign[]>('/campaigns'),
    enabled: mode === 'author' || mode === 'gamemaster' || mode === 'player',
  })

  // Reachable directly (bookmark, browser back) with a stale 'admin' mode —
  // that mode's home is /admin, not this page. See ModePicker.
  if (mode === 'admin') {
    return <Navigate to="/admin" replace />
  }

  if (!mode) {
    return (
      <AppShell>
        <ModePicker />
      </AppShell>
    )
  }

  const owned = campaigns.filter(c => c.access === 'owner' || !c.access)
  const memberOnly = campaigns.filter(c => c.access === 'member')

  return (
    <AppShell>
      <main className="px-6 py-8 max-w-4xl mx-auto">
        <div className="mb-6 rounded-lg overflow-hidden border">
          <img
            src="/dice.jpg"
            alt="Lore Engine"
            className="w-full h-40 object-cover"
            style={{ objectPosition: '50% 20%' }}
          />
        </div>

        {isLoading && <p className="text-muted-foreground text-sm">Chargement…</p>}

        {error && (
          <p className="text-destructive text-sm">Erreur : {error.message}</p>
        )}

        {!isLoading && !error && (
          <div className="space-y-10">
            {mode === 'author' && <AuthorDashboard campaigns={owned} />}
            {mode === 'gamemaster' && <GamemasterDashboard campaigns={campaigns} />}
            {mode === 'player' && (
              <>
                <TablesView memberCampaigns={memberOnly} />
                <CharactersView />
              </>
            )}
          </div>
        )}
      </main>
    </AppShell>
  )
}
