import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ArrowRight, ArrowLeft } from 'lucide-react'
import AppShell from '@/components/AppShell'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { Game, GameLoreEntity, GameLoreEntityRelation } from '@/types/game'

const KIND_LABELS: Record<string, string> = {
  district: 'District',
  faction: 'Faction',
  location: 'Lieu',
  npc_archetype: 'PNJ',
  item: 'Objet',
}

const KIND_COLORS: Record<string, string> = {
  district: 'bg-violet-500/10 text-violet-600 border-violet-500/30 dark:text-violet-400',
  faction: 'bg-red-500/10 text-red-600 border-red-500/30 dark:text-red-400',
  location: 'bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400',
  npc_archetype: 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400',
  item: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400',
}

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${KIND_COLORS[kind] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {kindLabel(kind)}
    </span>
  )
}

const PAGE_SIZE = 100

// ── Entity detail dialog ────────────────────────────────────────────────────

function EntityDetail({
  entity, entitiesById, relations, onNavigate,
}: {
  entity: GameLoreEntity
  entitiesById: Map<string, GameLoreEntity>
  relations: GameLoreEntityRelation[]
  onNavigate: (id: string) => void
}) {
  const outgoing = relations.filter(r => r.from_entity_id === entity.id)
  const incoming = relations.filter(r => r.to_entity_id === entity.id)

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <KindBadge kind={entity.kind} />
          <DialogTitle>{entity.name}</DialogTitle>
        </div>
      </DialogHeader>

      {entity.tags && (
        <div className="flex flex-wrap gap-1">
          {entity.tags.split(/\s+/).filter(Boolean).map(t => (
            <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
          ))}
        </div>
      )}

      {entity.summary && <p className="text-sm">{entity.summary}</p>}

      {entity.excerpt && (
        <blockquote className="text-sm italic text-muted-foreground border-l-2 pl-3">
          "{entity.excerpt}"
        </blockquote>
      )}

      <p className="text-xs text-muted-foreground">
        {entity.source_title}, page {entity.source_page}
      </p>

      {(outgoing.length > 0 || incoming.length > 0) && (
        <div className="space-y-2 pt-2 border-t">
          {outgoing.map(r => {
            const target = entitiesById.get(r.to_entity_id)
            if (!target) return null
            return (
              <button
                key={r.id}
                onClick={() => onNavigate(target.id)}
                className="w-full flex items-center gap-2 text-sm text-left hover:bg-muted rounded px-2 py-1 -mx-2"
              >
                <span className="text-muted-foreground shrink-0">{r.relation}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <KindBadge kind={target.kind} />
                <span className="truncate">{target.name}</span>
              </button>
            )
          })}
          {incoming.map(r => {
            const source = entitiesById.get(r.from_entity_id)
            if (!source) return null
            return (
              <button
                key={r.id}
                onClick={() => onNavigate(source.id)}
                className="w-full flex items-center gap-2 text-sm text-left hover:bg-muted rounded px-2 py-1 -mx-2"
              >
                <KindBadge kind={source.kind} />
                <span className="truncate">{source.name}</span>
                <ArrowLeft className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">{r.relation}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LorePage() {
  useDocTitle('lore: connaissances')

  const { data: games = [] } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })

  const [gameId, setGameId] = useState<string>('')
  const activeGameId = gameId || games[0]?.id || ''

  const { data: entities = [], isLoading: entitiesLoading } = useQuery({
    queryKey: ['game-lore-entities', activeGameId],
    queryFn: () => api.get<GameLoreEntity[]>(`/games/${activeGameId}/lore-entities`),
    enabled: !!activeGameId,
  })

  const { data: relations = [] } = useQuery({
    queryKey: ['game-lore-relations', activeGameId],
    queryFn: () => api.get<GameLoreEntityRelation[]>(`/games/${activeGameId}/lore-relations`),
    enabled: !!activeGameId,
  })

  const entitiesById = useMemo(() => {
    const m = new Map<string, GameLoreEntity>()
    for (const e of entities) m.set(e.id, e)
    return m
  }, [entities])

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of entities) counts[e.kind] = (counts[e.kind] ?? 0) + 1
    return counts
  }, [entities])

  const kinds = useMemo(
    () => Object.keys(kindCounts).sort((a, b) => kindLabel(a).localeCompare(kindLabel(b))),
    [kindCounts],
  )

  const [activeKind, setActiveKind] = useState<string>('')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (q) {
      return entities.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.tags.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q)
      )
    }
    const kind = activeKind || kinds[0]
    return entities.filter(e => e.kind === kind)
  }, [entities, q, activeKind, kinds])

  const shown = filtered.slice(0, visible)
  const selected = selectedId ? entitiesById.get(selectedId) ?? null : null

  return (
    <AppShell crumbs={[{ label: 'Connaissances' }]}>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h1 className="text-2xl font-bold">Connaissances de jeu</h1>
          {games.length > 1 && (
            <select
              value={activeGameId}
              onChange={e => { setGameId(e.target.value); setActiveKind(''); setQuery(''); setVisible(PAGE_SIZE) }}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {games.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </div>

        {games.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun jeu configuré.</p>
        )}

        {activeGameId && (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE) }}
                placeholder="Rechercher un nom, un tag…"
                className="pl-8"
              />
            </div>

            {!q && (
              <div className="flex gap-1.5 mb-4 flex-wrap">
                {kinds.map(k => (
                  <button
                    key={k}
                    onClick={() => { setActiveKind(k); setVisible(PAGE_SIZE) }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      (activeKind || kinds[0]) === k
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {kindLabel(k)} <span className="opacity-70">({kindCounts[k]})</span>
                  </button>
                ))}
              </div>
            )}

            {entitiesLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

            {!entitiesLoading && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun résultat.</p>
            )}

            <ul className="divide-y">
              {shown.map(e => (
                <li key={e.id}>
                  <button
                    onClick={() => setSelectedId(e.id)}
                    className="w-full flex items-start gap-3 py-2.5 text-left hover:bg-muted/50 px-2 -mx-2 rounded"
                  >
                    <KindBadge kind={e.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{e.name}</p>
                      {e.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{e.summary}</p>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {filtered.length > visible && (
              <button
                onClick={() => setVisible(v => v + PAGE_SIZE)}
                className="mt-4 text-sm text-muted-foreground hover:text-foreground"
              >
                Afficher {Math.min(PAGE_SIZE, filtered.length - visible)} de plus… ({filtered.length - visible} restants)
              </button>
            )}
          </>
        )}
      </main>

      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null) }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selected && (
            <EntityDetail
              entity={selected}
              entitiesById={entitiesById}
              relations={relations}
              onNavigate={setSelectedId}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
