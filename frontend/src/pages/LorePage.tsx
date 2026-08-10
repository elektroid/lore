import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import AppShell from '@/components/AppShell'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useUser } from '@/stores/auth'
import type { Game, GameLoreEntity, GameLoreEntitiesPage, GameLoreEntityRelationsResponse } from '@/types/game'

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

const PAGE_SIZE = 50

// ── Entity detail dialog ────────────────────────────────────────────────────

function EntityDetail({ entityId, gameId, knownKinds, onNavigate }: {
  entityId: string; gameId: string; knownKinds: string[]; onNavigate: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const isAdmin = useUser()?.role === 'superuser'

  const { data: entity } = useQuery({
    queryKey: ['game-lore-entity', gameId, entityId],
    queryFn: () => api.get<GameLoreEntity>(`/games/${gameId}/lore-entities/${entityId}`),
  })
  const { data: relations } = useQuery({
    queryKey: ['game-lore-entity-relations', gameId, entityId],
    queryFn: () => api.get<GameLoreEntityRelationsResponse>(`/games/${gameId}/lore-entities/${entityId}/relations`),
  })

  const updateKind = useMutation({
    mutationFn: (kind: string) => api.patch<GameLoreEntity>(`/games/${gameId}/lore-entities/${entityId}`, { kind }),
    onSuccess: updated => {
      queryClient.setQueryData(['game-lore-entity', gameId, entityId], updated)
      queryClient.invalidateQueries({ queryKey: ['game-lore-entities', gameId] })
      queryClient.invalidateQueries({ queryKey: ['game-lore-kinds', gameId] })
    },
  })

  if (!entity) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Chargement…</p>
  }

  const outgoing = relations?.outgoing ?? []
  const incoming = relations?.incoming ?? []
  const kindOptions = knownKinds.includes(entity.kind) ? knownKinds : [...knownKinds, entity.kind]

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin ? (
            <select
              value={entity.kind}
              onChange={e => updateKind.mutate(e.target.value)}
              disabled={updateKind.isPending}
              className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${KIND_COLORS[entity.kind] ?? 'bg-muted text-muted-foreground border-border'}`}
            >
              {kindOptions.map(k => (
                <option key={k} value={k}>{kindLabel(k)}</option>
              ))}
            </select>
          ) : (
            <KindBadge kind={entity.kind} />
          )}
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
          {outgoing.map(l => (
            <button
              key={l.relation_id}
              onClick={() => onNavigate(l.entity_id)}
              className="w-full flex items-center gap-2 text-sm text-left hover:bg-muted rounded px-2 py-1 -mx-2"
            >
              <span className="text-muted-foreground shrink-0">{l.relation}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <KindBadge kind={l.kind} />
              <span className="truncate">{l.name}</span>
            </button>
          ))}
          {incoming.map(l => (
            <button
              key={l.relation_id}
              onClick={() => onNavigate(l.entity_id)}
              className="w-full flex items-center gap-2 text-sm text-left hover:bg-muted rounded px-2 py-1 -mx-2"
            >
              <KindBadge kind={l.kind} />
              <span className="truncate">{l.name}</span>
              <ArrowLeft className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground shrink-0">{l.relation}</span>
            </button>
          ))}
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

  const [searchParams] = useSearchParams()
  const [gameId, setGameId] = useState<string>(searchParams.get('game') ?? '')
  const activeGameId = gameId || games[0]?.id || ''

  const { data: kindCounts = {} } = useQuery({
    queryKey: ['game-lore-kinds', activeGameId],
    queryFn: () => api.get<Record<string, number>>(`/games/${activeGameId}/lore-entity-kinds`),
    enabled: !!activeGameId,
  })
  const kinds = Object.keys(kindCounts).sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)))
  const totalEntities = Object.values(kindCounts).reduce((a, b) => a + b, 0)

  const [activeKind, setActiveKind] = useState<string>('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data, isLoading } = useQuery({
    queryKey: ['game-lore-entities', activeGameId, activeKind, debouncedQuery, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
      if (activeKind) params.set('kind', activeKind)
      if (debouncedQuery) params.set('q', debouncedQuery)
      return api.get<GameLoreEntitiesPage>(`/games/${activeGameId}/lore-entities?${params.toString()}`)
    },
    enabled: !!activeGameId,
  })

  const entities = data?.entities ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <AppShell crumbs={[{ label: 'Connaissances' }]}>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h1 className="text-2xl font-bold">Connaissances de jeu</h1>
          {games.length > 0 && (
            <select
              value={activeGameId}
              onChange={e => { setGameId(e.target.value); setActiveKind(''); setQuery(''); setDebouncedQuery(''); setPage(1) }}
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
                onChange={e => { setQuery(e.target.value); setPage(1) }}
                placeholder="Rechercher un nom, un tag…"
                className="pl-8"
              />
            </div>

            {kinds.length > 0 && (
              <div className="flex gap-1.5 mb-4 flex-wrap">
                <button
                  onClick={() => { setActiveKind(''); setPage(1) }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    activeKind === ''
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  Tous <span className="opacity-70">({totalEntities})</span>
                </button>
                {kinds.map(k => (
                  <button
                    key={k}
                    onClick={() => { setActiveKind(k); setPage(1) }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      activeKind === k
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {kindLabel(k)} <span className="opacity-70">({kindCounts[k]})</span>
                  </button>
                ))}
              </div>
            )}

            {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

            {!isLoading && entities.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun résultat.</p>
            )}

            <ul className="divide-y">
              {entities.map(e => (
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

            {total > 0 && (
              <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                <span>Page {page} sur {totalPages} ({total} résultats)</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <Dialog open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId(null) }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedId && (
            <EntityDetail entityId={selectedId} gameId={activeGameId} knownKinds={kinds} onNavigate={setSelectedId} />
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
