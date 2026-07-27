import { useState } from 'react'
import {
  Sparkles, Check, Trash2, RotateCcw, ChevronDown, ArrowRight, AlertTriangle, CircleCheck,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import LLMSuggestionReview, { type SuggestionField } from '@/components/LLMSuggestionReview'
import { api } from '@/api/client'
import {
  parseCoherency, VERDICT_LABELS, VERDICT_CLASSES,
  type SessionBeat, type Verdict,
} from '@/types/beat'

const BEAT_FIELDS: SuggestionField[] = [
  { key: 'title', label: 'Titre' },
  { key: 'description', label: 'Ce qui se passe', multiline: true },
  { key: 'outcome', label: 'Ce que ça laisse', multiline: true },
  { key: 'notes', label: 'Notes', multiline: true },
]

interface Props {
  scenarioId: string
  /** Narrow to one evening (play console) or show every session (prep). */
  sessionId?: string
  onOpenScene?: (sceneId: string) => void
}

// ── Coherency report ──────────────────────────────────────────────────────────

function CoherencyReport({ raw, onOpenScene }: { raw: string; onOpenScene?: (id: string) => void }) {
  const c = parseCoherency(raw)
  if (!c.summary && c.impacts.length === 0) return null

  const verdict = (c.verdict ?? 'ok') as Verdict
  const Icon = verdict === 'ok' ? CircleCheck : AlertTriangle

  return (
    <div className={`rounded-md border px-2.5 py-2 space-y-1.5 ${VERDICT_CLASSES[verdict] ?? VERDICT_CLASSES.ok}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-semibold">{VERDICT_LABELS[verdict] ?? verdict}</span>
      </div>
      {c.summary && <p className="text-xs">{c.summary}</p>}
      {c.impacts.length > 0 && (
        <ul className="space-y-0.5 pt-0.5">
          {c.impacts.map(im => (
            <li key={im.scene_ref} className="text-xs flex gap-1.5">
              <span className="opacity-60 shrink-0">↳</span>
              <span>
                {onOpenScene && im.scene_id ? (
                  <button className="font-medium hover:underline" onClick={() => onOpenScene(im.scene_id)}>
                    {im.title}
                  </button>
                ) : (
                  <span className="font-medium">{im.title}</span>
                )}
                {im.note && <span className="opacity-80"> — {im.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── One beat ──────────────────────────────────────────────────────────────────

function BeatCard({
  beat, scenarioId, showSession, onOpenScene, onResolved,
}: {
  beat: SessionBeat
  scenarioId: string
  showSession: boolean
  onOpenScene?: (sceneId: string) => void
  /** Adopting or ignoring moves a beat out of the open list. Tell the panel, so
   *  it unfolds the resolved group and the card stays where the GM is looking
   *  instead of silently vanishing under a click. */
  onResolved: () => void
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['beats', scenarioId] })
    qc.invalidateQueries({ queryKey: ['scenes', scenarioId] })
  }

  // First development writes straight into the beat: a beat is a draft, there
  // is nothing to lose. Re-developing one that already has text goes through
  // the field-by-field review, because now there is.
  const develop = useMutation({
    mutationFn: () => api.post<SessionBeat>(`/scenarios/${scenarioId}/beats/${beat.id}/develop`, {}),
    onSuccess: () => { invalidate(); setOpen(true); setError('') },
    onError: (e: Error) => setError(e.message),
  })

  const redevelop = useMutation({
    mutationFn: () =>
      api.post<Record<string, string>>(`/scenarios/${scenarioId}/beats/${beat.id}/develop`, {
        review: true,
        current: {
          title: beat.title, description: beat.description,
          outcome: beat.outcome, notes: beat.notes,
        },
      }),
    onSuccess: (s) => { setSuggestion(s); setError('') },
    onError: (e: Error) => setError(e.message),
  })

  const patch = useMutation({
    mutationFn: (body: Partial<SessionBeat>) =>
      api.put<SessionBeat>(`/scenarios/${scenarioId}/beats/${beat.id}`, body),
    onSuccess: invalidate,
  })

  const adopt = useMutation({
    mutationFn: () => api.post<SessionBeat>(`/scenarios/${scenarioId}/beats/${beat.id}/adopt`, {}),
    onSuccess: () => { invalidate(); onResolved() },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/scenarios/${scenarioId}/beats/${beat.id}`),
    onSuccess: invalidate,
  })

  const busy = develop.isPending || adopt.isPending || redevelop.isPending
  const adopted = beat.status === 'adopted'
  const dropped = beat.status === 'dropped'

  async function regenerate(keys: string[], instruction: string) {
    return api.post<Record<string, string>>(`/scenarios/${scenarioId}/beats/${beat.id}/develop`, {
      review: true,
      fields: keys,
      instruction,
      current: {
        title: beat.title, description: beat.description,
        outcome: beat.outcome, notes: beat.notes,
      },
    })
  }

  return (
    <li className={`rounded-md border bg-card p-2.5 space-y-2 ${dropped ? 'opacity-50' : ''}`}>
      {/* The GM's own words — always visible, never rewritten. */}
      <div className="flex items-start gap-2">
        <span className="text-amber-500 text-sm leading-5 shrink-0">”</span>
        <p className="flex-1 text-sm italic leading-5">{beat.note}</p>
        {(beat.title || beat.description) && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="text-muted-foreground/50 hover:text-muted-foreground shrink-0"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        {showSession && beat.session_name && <span>{beat.session_name}</span>}
        {beat.anchor_title && <span>↳ {beat.anchor_title}</span>}
        {adopted && (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> devenue une scène
          </span>
        )}
        {dropped && <span>écartée</span>}
      </div>

      {beat.status === 'developed' && !open && (
        <CoherencyReport raw={beat.coherency} onOpenScene={onOpenScene} />
      )}

      {open && (beat.title || beat.description) && (
        <div className="space-y-2 border-t pt-2">
          {beat.title && <p className="text-sm font-medium">{beat.title}</p>}
          <CoherencyReport raw={beat.coherency} onOpenScene={onOpenScene} />
          {beat.description && <p className="text-xs whitespace-pre-wrap leading-relaxed">{beat.description}</p>}
          {beat.outcome && (
            <p className="text-xs text-muted-foreground"><span className="font-medium">Laisse : </span>{beat.outcome}</p>
          )}
          {beat.notes && (
            <p className="text-xs text-muted-foreground"><span className="font-medium">Notes : </span>{beat.notes}</p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {suggestion && (
        <LLMSuggestionReview
          fields={BEAT_FIELDS}
          suggestion={suggestion}
          onAcceptField={(key, value) => patch.mutate({ [key]: value } as Partial<SessionBeat>)}
          onRegenerate={regenerate}
          onDone={() => setSuggestion(null)}
        />
      )}

      {/* Three verbs, and never more. */}
      {!adopted && !suggestion && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {!dropped && (
            <Button
              size="sm" variant="outline" className="h-6 px-2 text-xs"
              disabled={busy}
              onClick={() => beat.status === 'captured' ? develop.mutate() : redevelop.mutate()}
            >
              <Sparkles className={`h-3 w-3 mr-1 ${develop.isPending || redevelop.isPending ? 'animate-pulse' : ''}`} />
              {develop.isPending || redevelop.isPending
                ? 'Analyse…'
                : beat.status === 'captured' ? 'Développer' : 'Redévelopper'}
            </Button>
          )}
          {!dropped && (
            <Button size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={() => adopt.mutate()}>
              <Check className="h-3 w-3 mr-1" />
              {adopt.isPending ? 'Ajout…' : 'Adopter'}
            </Button>
          )}
          {dropped ? (
            <Button
              size="sm" variant="ghost" className="h-6 px-2 text-xs"
              onClick={() => patch.mutate({ status: 'captured' })}
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Restaurer
            </Button>
          ) : (
            <Button
              size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => { patch.mutate({ status: 'dropped' }); onResolved() }}
            >
              Ignorer
            </Button>
          )}
          <Button
            size="sm" variant="ghost"
            className="h-6 w-6 p-0 ml-auto text-muted-foreground hover:text-destructive"
            onClick={() => { if (confirm('Supprimer cette note ?')) remove.mutate() }}
            title="Supprimer définitivement"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}

      {adopted && onOpenScene && beat.scene_id && (
        <Button
          size="sm" variant="ghost" className="h-6 px-2 text-xs"
          onClick={() => onOpenScene(beat.scene_id)}
        >
          Voir la scène <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      )}
    </li>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function ImprovPanel({ scenarioId, sessionId, onOpenScene }: Props) {
  const [showResolved, setShowResolved] = useState(false)

  const { data: beats = [], isLoading } = useQuery({
    queryKey: ['beats', scenarioId, sessionId ?? 'all'],
    queryFn: () => api.get<SessionBeat[]>(
      `/scenarios/${scenarioId}/beats${sessionId ? `?session_id=${sessionId}` : ''}`),
  })

  const open = beats.filter(b => b.status === 'captured' || b.status === 'developed')
  const resolved = beats.filter(b => b.status === 'adopted' || b.status === 'dropped')
  const shown = showResolved ? [...open, ...resolved] : open

  if (isLoading) return <p className="text-xs text-muted-foreground">Chargement…</p>

  return (
    <div className="space-y-2">
      {beats.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Rien pour l'instant. Notez ce que les joueurs inventent — vous en ferez des scènes plus tard.
        </p>
      )}

      {shown.length > 0 && (
        <ul className="space-y-1.5">
          {shown.map(b => (
            <BeatCard
              key={b.id}
              beat={b}
              scenarioId={scenarioId}
              showSession={!sessionId}
              onOpenScene={onOpenScene}
              onResolved={() => setShowResolved(true)}
            />
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <button
          type="button"
          onClick={() => setShowResolved(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showResolved ? 'Masquer' : 'Voir'} les {resolved.length} note{resolved.length > 1 ? 's' : ''} traitée{resolved.length > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
