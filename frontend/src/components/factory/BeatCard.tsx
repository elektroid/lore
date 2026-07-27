import { useState } from 'react'
import { ChevronDown, MapPin, Play, Flag, Sparkles, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import LLMSuggestionReview, { type SuggestionField } from '@/components/LLMSuggestionReview'
import { AutoTextarea, IncludeToggle, FieldLabel } from './fields'
import { SCENE_STATUS_LABELS, type SceneStatus } from '@/types/synopsis'
import type { Proposal, ProposalScene } from '@/types/factory'

const BEAT_FIELDS: SuggestionField[] = [
  { key: 'description', label: 'Ce qui se passe', multiline: true },
  { key: 'outcome', label: 'Dénouement', multiline: true },
  { key: 'notes', label: 'Notes', multiline: true },
]

const STATUS_DOT: Record<SceneStatus, string> = {
  idea: 'bg-muted-foreground/40',
  optional_step: 'bg-amber-400',
  key_event: 'bg-primary',
}

interface Props {
  scene: ProposalScene
  index: number
  proposal: Proposal
  busy: boolean
  onPatch: (patch: Partial<ProposalScene>) => void
  onExpand: (fields: string[], instruction: string) => Promise<Record<string, string>>
}

export default function BeatCard({ scene, index, proposal, busy, onPatch, onExpand }: Props) {
  const [open, setOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<Record<string, string> | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const location = proposal.locations.find(l => l.ref === scene.location_ref)
  const npcs = scene.npc_refs
    .map(ref => proposal.npcs.find(n => n.ref === ref))
    .filter((n): n is NonNullable<typeof n> => !!n)
  const artefacts = scene.artefact_refs
    .map(ref => proposal.artefacts.find(a => a.ref === ref))
    .filter((a): a is NonNullable<typeof a> => !!a)

  async function develop() {
    setError('')
    setGenerating(true)
    try {
      setSuggestion(await onExpand([], ''))
      setOpen(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const dimmed = !scene.include

  return (
    <li className={`rounded-md border bg-card transition-opacity ${dimmed ? 'opacity-45' : ''}`}>
      {/* Header row — always visible */}
      <div className="flex items-center gap-2 px-3 py-2">
        <IncludeToggle checked={scene.include} onChange={v => onPatch({ include: v })} />
        <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">{index + 1}.</span>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[scene.status] ?? STATUS_DOT.idea}`} />

        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex-1 text-sm font-medium truncate hover:underline text-left"
        >
          {scene.title || <span className="text-muted-foreground italic">(sans titre)</span>}
        </button>

        {scene.is_start && <span title="Scène de départ"><Play className="h-3 w-3 shrink-0 text-emerald-600" /></span>}
        {scene.is_end && <span title="Scène de fin"><Flag className="h-3 w-3 shrink-0 text-rose-500" /></span>}
        {scene.expanded && <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wide">développée</span>}
        {location && (
          <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[120px]">{location.name}</span>
        )}

        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="text-muted-foreground/50 hover:text-muted-foreground shrink-0"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>

      {/* Collapsed preview */}
      {!open && scene.summary && (
        <p className="px-3 pb-2 pl-[4.25rem] text-xs text-muted-foreground line-clamp-2">{scene.summary}</p>
      )}

      {/* Expanded editor */}
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t">
          <div className="flex items-center gap-2">
            <Input
              value={scene.title}
              onChange={e => onPatch({ title: e.target.value })}
              placeholder="Titre de la scène"
              className="h-8 text-sm flex-1"
            />
            <select
              value={scene.status}
              onChange={e => onPatch({ status: e.target.value as SceneStatus })}
              className="text-xs rounded border border-input bg-background px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
            >
              {(Object.entries(SCENE_STATUS_LABELS) as [SceneStatus, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onPatch({ is_start: !scene.is_start })}
              className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                scene.is_start
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Play className="h-3 w-3" /> Départ
            </button>
            <button
              type="button"
              onClick={() => onPatch({ is_end: !scene.is_end })}
              className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                scene.is_end
                  ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950 dark:border-rose-700 dark:text-rose-400'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Flag className="h-3 w-3" /> Fin
            </button>
          </div>

          {/* Location — chosen among what the draft proposes */}
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <select
              value={scene.location_ref}
              onChange={e => onPatch({ location_ref: e.target.value })}
              className="text-xs rounded border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring flex-1"
            >
              <option value="">— aucun lieu —</option>
              {proposal.locations.map(l => (
                <option key={l.ref} value={l.ref}>{l.name}{l.include ? '' : ' (retiré)'}</option>
              ))}
            </select>
          </div>

          {/* Cast present in this beat */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <FieldLabel>Personnages</FieldLabel>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {proposal.npcs.length === 0 && <p className="text-xs text-muted-foreground">Aucun PNJ proposé.</p>}
              {proposal.npcs.map(n => {
                const on = scene.npc_refs.includes(n.ref)
                return (
                  <button
                    key={n.ref}
                    type="button"
                    onClick={() => onPatch({
                      npc_refs: on ? scene.npc_refs.filter(r => r !== n.ref) : [...scene.npc_refs, n.ref],
                    })}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      on
                        ? 'bg-primary/10 border-primary/40 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {n.name}
                  </button>
                )
              })}
            </div>
          </div>

          {proposal.artefacts.length > 0 && (
            <div className="space-y-1">
              <FieldLabel>Artefacts</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {proposal.artefacts.map(a => {
                  const on = scene.artefact_refs.includes(a.ref)
                  return (
                    <button
                      key={a.ref}
                      type="button"
                      onClick={() => onPatch({
                        artefact_refs: on ? scene.artefact_refs.filter(r => r !== a.ref) : [...scene.artefact_refs, a.ref],
                      })}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        on
                          ? 'bg-primary/10 border-primary/40 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {a.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <FieldLabel>Résumé</FieldLabel>
            <AutoTextarea value={scene.summary} onChange={v => onPatch({ summary: v })} placeholder="Ce qui se joue, en une phrase" />
          </div>

          {/* Long-form fields — filled by the expand stage */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <FieldLabel>Ce qui se passe</FieldLabel>
              {!suggestion && (
                <Button
                  size="sm" variant="ghost" className="h-6 px-2 text-xs"
                  disabled={generating || busy}
                  onClick={develop}
                >
                  <Sparkles className={`h-3 w-3 mr-1 ${generating ? 'animate-pulse' : ''}`} />
                  {generating ? 'Génération…' : scene.expanded ? 'Redévelopper' : 'Développer'}
                </Button>
              )}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <AutoTextarea
              value={scene.description}
              onChange={v => onPatch({ description: v })}
              placeholder="Non développée — cliquez sur Développer"
              rows={4}
            />
          </div>

          <div className="space-y-1">
            <FieldLabel>Dénouement</FieldLabel>
            <AutoTextarea value={scene.outcome} onChange={v => onPatch({ outcome: v })} placeholder="Où cette scène laisse les PJs" />
          </div>

          <div className="space-y-1">
            <FieldLabel>Notes MJ</FieldLabel>
            <AutoTextarea value={scene.notes} onChange={v => onPatch({ notes: v })} placeholder="Ambiance, accessoires, détails utiles" />
          </div>

          {/* Re-developing a beat that already has text is the one place the
              field-by-field review still applies — there is something to lose. */}
          {suggestion && (
            <LLMSuggestionReview
              fields={BEAT_FIELDS}
              suggestion={suggestion}
              onAcceptField={(key, value) => onPatch({ [key]: value } as Partial<ProposalScene>)}
              onRegenerate={onExpand}
              onDone={() => setSuggestion(null)}
            />
          )}

          {artefacts.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Artefacts liés : {artefacts.map(a => a.name).join(', ')}
            </p>
          )}
          {npcs.some(n => !n.include) && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Certains PNJ de cette scène sont retirés du scénario — ils ne seront pas liés.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
