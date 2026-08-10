import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Calendar, Radio, NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import { RUN_STATUS_LABELS } from '@/types/run'
import type { PlayerRunDetail, RunNote } from '@/types/me'
import type { ListCharactersResponse, PlayerCharacter } from '@/types/character'

const NOTE_SAVE_DEBOUNCE_MS = 800

/** Pick or hand off to creating a character for this run's game. */
function CharacterPanel({ run, runId }: { run: PlayerRunDetail; runId: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [picking, setPicking] = useState(false)

  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => api.get<ListCharactersResponse>('/characters').then(r => r.characters),
    enabled: picking,
  })
  const eligible = characters.filter(
    (c: PlayerCharacter) => !run.game_id || c.game_id === run.game_id
  )

  const setCharacter = useMutation({
    mutationFn: (characterId: string) =>
      api.put<PlayerRunDetail>(`/me/runs/${runId}/character`, { character_id: characterId }),
    onSuccess: (updated) => {
      qc.setQueryData(['me-run', runId], updated)
      qc.invalidateQueries({ queryKey: ['me-runs'] })
      setPicking(false)
    },
  })

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Votre personnage</p>
      {run.character_id && !picking ? (
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <p className="text-sm font-medium">{run.character_name || <span className="italic text-muted-foreground">(sans nom)</span>}</p>
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>Changer</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {!run.character_id && (
            <p className="text-xs text-muted-foreground">Aucun personnage assigné pour ce groupe.</p>
          )}
          {!picking ? (
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>Choisir un personnage</Button>
          ) : (
            <div className="space-y-2">
              {eligible.length > 0 ? (
                <ul className="border rounded-md divide-y">
                  {eligible.map(c => (
                    <li key={c.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm">{c.name || <span className="italic text-muted-foreground">(sans nom)</span>}</span>
                      <Button
                        size="sm" variant="ghost"
                        disabled={setCharacter.isPending}
                        onClick={() => setCharacter.mutate(c.id)}
                      >
                        Choisir
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Vous n'avez pas encore de personnage pour ce jeu.</p>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/')}>
                  Nouveau personnage depuis l'accueil
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Annuler</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SessionsList({ run }: { run: PlayerRunDetail }) {
  const latest = run.sessions[0]
  const tableToken = latest?.table_token

  return (
    <div className="space-y-3 pt-6 border-t">
      <p className="text-sm font-medium">Sessions</p>
      {tableToken && (
        <a
          href={`/table/${tableToken}/player`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-3 rounded-md border border-primary/40 bg-primary/5 text-sm font-medium hover:bg-primary/10 transition-colors"
        >
          <Radio className="h-4 w-4" />
          Rejoindre la table
        </a>
      )}
      {run.sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune session pour l'instant.</p>
      ) : (
        <ul className="space-y-1.5">
          {run.sessions.map(s => (
            <li key={s.id} className="flex items-center gap-3 p-3 rounded-md border bg-card">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm">{s.name || <span className="italic text-muted-foreground">(sans nom)</span>}</span>
              {s.date && <span className="text-xs text-muted-foreground">{s.date}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NotesPanel({ runId }: { runId: string }) {
  const { data: note } = useQuery({
    queryKey: ['me-run-notes', runId],
    queryFn: () => api.get<RunNote>(`/me/runs/${runId}/notes`),
  })

  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (note && !loaded.current) {
      setBody(note.body)
      loaded.current = true
    }
  }, [note])

  const save = useMutation({
    mutationFn: (b: string) => api.put<RunNote>(`/me/runs/${runId}/notes`, { body: b }),
    onSettled: () => setSaving(false),
  })

  function handleChange(v: string) {
    setBody(v)
    setSaving(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save.mutate(v), NOTE_SAVE_DEBOUNCE_MS)
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  return (
    <div className="space-y-3 pt-6 border-t">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <NotebookPen className="h-3.5 w-3.5" />
          Vos notes
        </p>
        {saving && <span className="text-xs text-muted-foreground">Sauvegarde…</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Privées — seulement visibles par vous.
      </p>
      <textarea
        value={body}
        onChange={e => handleChange(e.target.value)}
        rows={8}
        placeholder="Vos souvenirs, théories, rappels…"
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

export default function RunPlayerPage() {
  const { runId } = useParams<{ runId: string }>()

  const { data: run, isLoading, error } = useQuery({
    queryKey: ['me-run', runId],
    queryFn: () => api.get<PlayerRunDetail>(`/me/runs/${runId}`),
  })

  useDocTitle(run ? `lore: ${run.run_name}` : 'lore')

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground text-sm">Chargement…</p>
        </div>
      </AppShell>
    )
  }

  if (error || !run) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <p className="text-destructive text-sm">{error?.message ?? 'Groupe introuvable'}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell crumbs={[{ label: run.campaign_name }, { label: run.run_name }]}>
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{run.run_name}</h1>
            <p className="text-sm text-muted-foreground">{run.campaign_name}</p>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {RUN_STATUS_LABELS[run.status]}
          </span>
        </div>

        <CharacterPanel run={run} runId={runId!} />
        <SessionsList run={run} />
        <NotesPanel runId={runId!} />
      </main>
    </AppShell>
  )
}
