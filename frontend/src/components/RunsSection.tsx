import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, UserPlus, Users, ChevronDown, ChevronRight, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api/client'
import type { Run, RunPlayer, RunStatus } from '@/types/run'
import { RUN_STATUS_LABELS } from '@/types/run'
import type { MemberWithCharacters } from '@/types/session'

/**
 * Groups playing this campaign, and who is in them.
 *
 * This is the party — distinct from Accès above it, which is the list of
 * accounts allowed to open the campaign. A person needs access before they can
 * be put in a group, but access alone does not seat them at a table.
 * See docs/adr/0001-runs-separate-story-from-play.md.
 */
export default function RunsSection({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  const { data: runs = [] } = useQuery({
    queryKey: ['runs', campaignId],
    queryFn: () => api.get<Run[]>(`/campaigns/${campaignId}/runs`),
  })

  const createRun = useMutation({
    mutationFn: (name: string) => api.post<Run>(`/campaigns/${campaignId}/runs`, { name }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs', campaignId] })
      setNewName('')
      setAdding(false)
      setExpanded(run.id)
    },
  })

  const deleteRun = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${campaignId}/runs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', campaignId] }),
  })

  const updateRun = useMutation({
    mutationFn: (run: Run) =>
      api.put<Run>(`/campaigns/${campaignId}/runs/${run.id}`, {
        name: run.name, notes: run.notes, status: run.status,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', campaignId] }),
  })

  return (
    <div className="space-y-3 pt-6 border-t">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Groupes</p>
          <p className="text-xs text-muted-foreground">
            Chaque groupe joue la campagne de son côté, avec sa propre progression.
            Le scénario, lui, reste le même pour tous.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Nouveau groupe
        </Button>
      </div>

      {adding && (
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="Ex : Les Vagabonds du mardi"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) createRun.mutate(newName.trim())
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            disabled={!newName.trim() || createRun.isPending}
            onClick={() => createRun.mutate(newName.trim())}
          >
            Créer
          </Button>
        </div>
      )}

      {runs.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          Aucun groupe. Créez-en un pour pouvoir lancer une session.
        </p>
      )}

      <ul className="space-y-1.5">
        {runs.map(run => (
          <RunRow
            key={run.id}
            run={run}
            campaignId={campaignId}
            open={expanded === run.id}
            onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
            onDelete={() => {
              if (confirm(`Supprimer « ${run.name} » ? Ses sessions et tout ce qui y a été joué seront perdus. Le scénario n'est pas touché.`)) {
                deleteRun.mutate(run.id)
              }
            }}
            onStatus={(status: RunStatus) => updateRun.mutate({ ...run, status })}
          />
        ))}
      </ul>
    </div>
  )
}

function RunRow({
  run, campaignId, open, onToggle, onDelete, onStatus,
}: {
  run: Run
  campaignId: string
  open: boolean
  onToggle: () => void
  onDelete: () => void
  onStatus: (s: RunStatus) => void
}) {
  return (
    <li className="rounded-md border bg-card">
      <div className="flex items-center gap-3 p-3">
        <button onClick={onToggle} className="text-muted-foreground shrink-0">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <button onClick={onToggle} className="text-sm font-medium truncate hover:underline text-left flex-1">
          {run.name || <span className="text-muted-foreground italic">(sans nom)</span>}
        </button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Users className="h-3 w-3" />
          {run.player_count}
        </span>
        <select
          value={run.status}
          onChange={e => onStatus(e.target.value as RunStatus)}
          onClick={e => e.stopPropagation()}
          className="text-xs rounded border border-input bg-background px-1.5 py-1 shrink-0 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {(Object.keys(RUN_STATUS_LABELS) as RunStatus[]).map(s => (
            <option key={s} value={s}>{RUN_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <Button
          variant="ghost" size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {open && <RunParty runId={run.id} campaignId={campaignId} />}
    </li>
  )
}

/** The party: who plays with this group, and as whom. */
function RunParty({ runId, campaignId }: { runId: string; campaignId: string }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: players = [] } = useQuery({
    queryKey: ['run-players', runId],
    queryFn: () => api.get<RunPlayer[]>(`/campaigns/${campaignId}/runs/${runId}/players`),
  })

  const { data: members = [] } = useQuery({
    queryKey: ['member-characters', campaignId],
    queryFn: () => api.get<MemberWithCharacters[]>(`/campaigns/${campaignId}/members/characters`),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['run-players', runId] })
    qc.invalidateQueries({ queryKey: ['runs', campaignId] })
  }

  const setPlayer = useMutation({
    mutationFn: ({ userId, characterId }: { userId: string; characterId: string }) =>
      api.put(`/campaigns/${campaignId}/runs/${runId}/players/${userId}`, { character_id: characterId }),
    onSuccess: invalidate,
  })

  const removePlayer = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/campaigns/${campaignId}/runs/${runId}/players/${userId}`),
    onSuccess: invalidate,
  })

  const enrolled = new Set(players.map(p => p.user_id))
  const available = members.filter(m => !enrolled.has(m.user_id))
  const filtered = search.trim()
    ? available.filter(m =>
        m.user_name.toLowerCase().includes(search.toLowerCase()) ||
        m.user_email.toLowerCase().includes(search.toLowerCase()))
    : available

  const charactersOf = (userId: string) =>
    members.find(m => m.user_id === userId)?.characters ?? []

  return (
    <div className="border-t px-3 py-3 space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Joueurs du groupe
        </p>
        {players.length === 0 && (
          <p className="text-xs text-muted-foreground">Aucun joueur dans ce groupe.</p>
        )}

        {players.length > 0 && (
          <ul className="space-y-1">
            {players.map(p => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{p.user_name}</span>
                <select
                  value={p.character_id}
                  onChange={e => setPlayer.mutate({ userId: p.user_id, characterId: e.target.value })}
                  className="text-xs rounded border border-input bg-background px-1.5 py-1 max-w-[45%] focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— Aucun personnage —</option>
                  {charactersOf(p.user_id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removePlayer.mutate(p.user_id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {members.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-dashed">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Joueurs existant sur le serveur
          </p>
          {available.length > 0 ? (
            <>
              <Input
                placeholder="Rechercher un compte à ajouter…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-7 text-xs"
              />
              {(search.trim() || players.length === 0) && (
                <ul className="border rounded-md divide-y max-h-40 overflow-y-auto">
                  {filtered.map(m => (
                    <li key={m.user_id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="text-xs flex-1 truncate">{m.user_name}</span>
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0"
                        onClick={() => { setPlayer.mutate({ userId: m.user_id, characterId: '' }); setSearch('') }}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                  {filtered.length === 0 && (
                    <li className="px-2 py-1.5 text-xs text-muted-foreground">Aucun résultat.</li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Tous les comptes ayant accès sont déjà dans ce groupe.</p>
          )}
        </div>
      )}

      {members.length === 0 && (
        <p className="text-xs text-muted-foreground pt-3 border-t border-dashed">
          Personne n'a encore accès à cette campagne — ajoutez des comptes dans « Accès » ci-dessus.
        </p>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1 pt-3 border-t">
        <Play className="h-3 w-3" />
        Les sessions de ce groupe se lancent depuis un scénario, en mode Play.
      </p>
    </div>
  )
}
