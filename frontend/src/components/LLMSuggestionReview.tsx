import { useEffect, useRef, useState } from 'react'
import { Check, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SuggestionField {
  key: string
  label: string
  multiline?: boolean
}

interface Props {
  fields: SuggestionField[]
  suggestion: Record<string, string>
  onAcceptField: (key: string, value: string) => void
  onRegenerate: (keys: string[], instruction: string) => Promise<Record<string, string>>
  onDone: () => void
}

// ── Auto-grow editable suggestion text ───────────────────────────────────────

function DraftField({ value, onChange, multiline }: {
  value: string; onChange: (v: string) => void; multiline?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={multiline ? 3 : 1}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full resize-none overflow-hidden rounded border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

// ── Granular LLM suggestion review ───────────────────────────────────────────
//
// Renders one card per not-yet-resolved field: an editable draft (tweak the
// wording before committing), plus Accepter / Régénérer / Ignorer. Nothing
// is applied in bulk — the GM decides field by field, exactly like they'd
// pick and choose lines from a co-writer's draft. Calls onDone once every
// field has been accepted or ignored.

export default function LLMSuggestionReview({ fields, suggestion, onAcceptField, onRegenerate, onDone }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>(suggestion)
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const [instruction, setInstruction] = useState('')
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const openFields = fields.filter(f => !resolved.has(f.key))

  useEffect(() => {
    if (openFields.length === 0) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved])

  if (openFields.length === 0) return null

  function accept(key: string) {
    onAcceptField(key, drafts[key] ?? '')
    setResolved(prev => new Set(prev).add(key))
  }

  function ignore(key: string) {
    setResolved(prev => new Set(prev).add(key))
  }

  async function regenerate(keys: string[]) {
    setError('')
    setBusyKeys(prev => new Set([...prev, ...keys]))
    try {
      const result = await onRegenerate(keys, instruction)
      setDrafts(prev => {
        const next = { ...prev }
        keys.forEach(k => { if (result[k] !== undefined) next[k] = result[k] })
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyKeys(prev => { const next = new Set(prev); keys.forEach(k => next.delete(k)); return next })
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-primary">Proposition du LLM — acceptez, modifiez ou ignorez champ par champ</p>
        <button type="button" onClick={onDone} className="text-muted-foreground hover:text-foreground shrink-0" title="Fermer sans appliquer le reste">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder="Précisions pour le LLM (optionnel) : plus sombre, garde le prénom…"
          className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {openFields.length > 1 && (
          <Button
            type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0"
            disabled={busyKeys.size > 0}
            onClick={() => regenerate(openFields.map(f => f.key))}
          >
            <RotateCw className={`h-3 w-3 mr-1 ${busyKeys.size > 0 ? 'animate-spin' : ''}`} />
            Tout régénérer
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-2.5">
        {openFields.map(f => (
          <div key={f.key} className="space-y-1">
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <DraftField
              value={drafts[f.key] ?? ''}
              onChange={v => setDrafts(prev => ({ ...prev, [f.key]: v }))}
              multiline={f.multiline}
            />
            <div className="flex items-center gap-1.5">
              <Button type="button" size="sm" className="h-6 px-2 text-xs" disabled={busyKeys.has(f.key)} onClick={() => accept(f.key)}>
                <Check className="h-3 w-3 mr-1" /> Accepter
              </Button>
              <Button
                type="button" size="sm" variant="outline" className="h-6 px-2 text-xs"
                disabled={busyKeys.has(f.key)}
                onClick={() => regenerate([f.key])}
              >
                <RotateCw className={`h-3 w-3 mr-1 ${busyKeys.has(f.key) ? 'animate-spin' : ''}`} />
                Régénérer
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => ignore(f.key)}>
                Ignorer
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
