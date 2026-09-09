import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api/client'
import { toast } from '@/stores/toast'

/**
 * The write journal — every accepted write, with the record as it stood before
 * it. See docs/adr/0002-write-journal-for-recovery.md.
 *
 * This is a debug facility for the period before the app is trusted, not a
 * version history: no redo, no branching, no ordering guarantees across
 * entities. "Restaurer" writes one old value back through the normal update
 * path, and is itself journalled — restoring the wrong version is undone by
 * restoring the right one.
 */

interface JournalEntry {
  id: string
  at: string
  user_id: string
  user_email: string
  method: string
  path: string
  entity: string
  entity_id: string
  before: string
  payload: string
  status: number
}

interface JournalStats {
  entries: number
  bytes: number
  oldest: string
}

interface JournalPage {
  entries: JournalEntry[]
  total: number
  stats: JournalStats
}

const PAGE_SIZE = 40

const ENTITY_LABELS: Record<string, string> = {
  scene: 'Scène',
  synopsis: 'Synopsis',
  scenario: 'Scénario',
  campaign: 'Campagne',
  npc: 'PNJ',
  location: 'Lieu',
  artefact: 'Artefact',
  faction: 'Faction',
}

function humanBytes(n: number) {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`
}

function parseObject(json: string): Record<string, unknown> {
  if (!json) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch { return {} }
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/**
 * The fields this write actually changed.
 *
 * Only fields present in the payload are considered: a full-record PUT sends
 * every column, so listing all of them would bury the one that matters. And
 * that is the whole diagnostic question — which field did this write move, and
 * what was there before it.
 */
function changedFields(entry: JournalEntry) {
  const before = parseObject(entry.before)
  const after = parseObject(entry.payload)
  return Object.keys(after)
    .filter(k => asText(after[k]) !== asText(before[k]))
    .map(k => ({ field: k, from: asText(before[k]), to: asText(after[k]) }))
}

function ValueBlock({ label, value, tone }: { label: string; value: string; tone: 'before' | 'after' }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <pre
        className={`text-xs whitespace-pre-wrap break-words rounded-md border p-2 max-h-64 overflow-y-auto ${
          tone === 'before'
            ? 'bg-destructive/5 border-destructive/20'
            : 'bg-emerald-500/5 border-emerald-500/20'
        }`}
      >
        {value || <span className="text-muted-foreground italic">(vide)</span>}
      </pre>
    </div>
  )
}

function EntryDialog({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const qc = useQueryClient()
  const changes = changedFields(entry)

  const restore = useMutation({
    mutationFn: () => api.post(`/journal/${entry.id}/restore`, {}),
    onSuccess: () => {
      toast.success('Version restaurée.')
      qc.invalidateQueries()
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {ENTITY_LABELS[entry.entity] ?? entry.entity ?? 'Écriture'}
            <span className="text-muted-foreground font-normal">
              {' · '}{new Date(entry.at + 'Z').toLocaleString('fr-FR')}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p><span className="font-medium text-foreground">{entry.user_email || 'inconnu'}</span> — {entry.method} {entry.path}</p>
        </div>

        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cette écriture n'a modifié aucun champ — le contenu envoyé était déjà celui enregistré.
            </p>
          ) : changes.map(c => (
            <div key={c.field} className="space-y-1">
              <p className="text-xs font-semibold">{c.field}</p>
              <div className="flex gap-3">
                <ValueBlock label="Avant" value={c.from} tone="before" />
                <ValueBlock label="Après" value={c.to} tone="after" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            {entry.before
              ? 'Restaurer réécrit l’état « avant » — l’opération est elle-même journalisée.'
              : 'Aucun état antérieur enregistré pour cette écriture.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!entry.before || restore.isPending}
            onClick={() => restore.mutate()}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            {restore.isPending ? 'Restauration…' : 'Restaurer cette version'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function WriteJournalTab() {
  const [entity, setEntity] = useState('')
  const [entityId, setEntityId] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<JournalEntry | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-journal', entity, entityId, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
      if (entity) params.set('entity', entity)
      if (entityId.trim()) params.set('entity_id', entityId.trim())
      return api.get<JournalPage>(`/journal?${params.toString()}`)
    },
  })

  const entries = data?.entries ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <p className="text-sm text-muted-foreground mb-4">
        Chaque écriture acceptée par l'API, avec l'état du contenu juste avant elle.
        De quoi comprendre — et annuler — une modification qui en a effacé une autre.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={entity}
          onChange={e => { setEntity(e.target.value); setPage(0) }}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Tous les contenus</option>
          {Object.entries(ENTITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={entityId}
            onChange={e => { setEntityId(e.target.value); setPage(0) }}
            placeholder="Filtrer par identifiant…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {data?.stats && (
        <p className="text-xs text-muted-foreground mb-4">
          {data.stats.entries.toLocaleString('fr-FR')} écritures conservées · {humanBytes(data.stats.bytes)}
          {data.stats.oldest && ` · depuis le ${new Date(data.stats.oldest + 'Z').toLocaleDateString('fr-FR')}`}
        </p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {!isLoading && entries.length === 0 && <p className="text-sm text-muted-foreground">Aucune écriture.</p>}

      {entries.length > 0 && (
        <ul className="divide-y">
          {entries.map(e => {
            const changes = changedFields(e)
            return (
              <li key={e.id}>
                <button
                  onClick={() => setOpen(e)}
                  className="w-full text-left py-2.5 flex items-start gap-3 text-sm hover:bg-accent/40 transition-colors px-2 -mx-2 rounded"
                >
                  <span className="text-xs text-muted-foreground shrink-0 w-32 tabular-nums">
                    {new Date(e.at + 'Z').toLocaleString('fr-FR')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="font-medium">{ENTITY_LABELS[e.entity] ?? e.entity ?? '—'}</span>
                      <span className="text-muted-foreground"> · {e.user_email || 'inconnu'}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {changes.length === 0
                        ? 'aucun champ modifié'
                        : changes.map(c => c.field).join(', ')}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{e.method}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>Page {page + 1} sur {totalPages} ({total} écritures)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page <= 0}
              className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {open && <EntryDialog entry={open} onClose={() => setOpen(null)} />}
    </>
  )
}
