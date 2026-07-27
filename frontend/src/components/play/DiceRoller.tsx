import { useState } from 'react'
import { Dices, Minus, Plus, X } from 'lucide-react'
import { QUICK_DICE, addDie, addModifier, isValidNotation } from '@/lib/dice'
import type { Tone } from './RollFeed'

const TONE = {
  app: {
    chip: 'border-border bg-card hover:bg-accent text-foreground',
    field: 'border-input bg-background text-foreground placeholder:text-muted-foreground',
    muted: 'text-muted-foreground',
    roll: 'bg-primary text-primary-foreground hover:bg-primary/90',
    invalid: 'border-destructive',
  },
  stage: {
    chip: 'border-white/15 bg-white/5 hover:bg-white/10 text-white',
    field: 'border-white/15 bg-white/5 text-white placeholder:text-white/30',
    muted: 'text-white/50',
    roll: 'bg-white text-black hover:bg-white/90',
    invalid: 'border-rose-500',
  },
} as const

/**
 * The dice tray, shared by the GM console and the player seats. It only composes
 * a notation string — the server rolls, so nobody can nudge a result and everyone
 * sees the same number at the same moment.
 */
export default function DiceRoller({
  onRoll, pending = false, tone = 'app', error, children,
}: {
  onRoll: (notation: string, label: string) => void
  pending?: boolean
  tone?: Tone
  error?: string | null
  /** Extra controls next to the roll button — the GM's secret toggle. */
  children?: React.ReactNode
}) {
  const t = TONE[tone]
  const [notation, setNotation] = useState('')
  const [label, setLabel] = useState('')

  const valid = isValidNotation(notation)
  const dirty = notation.trim().length > 0

  function submit() {
    if (!valid || pending) return
    onRoll(notation.trim(), label.trim())
    setNotation('')
  }

  return (
    <div className="space-y-2">
      {/* Quick dice — clicking d6 three times gives 3d6, like a growing handful */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_DICE.map(sides => (
          <button
            key={sides}
            type="button"
            onClick={() => setNotation(n => addDie(n, sides))}
            className={`h-8 min-w-[2.75rem] rounded-md border px-2 text-xs font-medium transition-colors ${t.chip}`}
          >
            d{sides}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => setNotation(n => addModifier(n, -1))}
            className={`h-8 w-8 rounded-md border transition-colors flex items-center justify-center ${t.chip}`}
            title="Modificateur −1"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setNotation(n => addModifier(n, 1))}
            className={`h-8 w-8 rounded-md border transition-colors flex items-center justify-center ${t.chip}`}
            title="Modificateur +1"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Notation + label */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input
            value={notation}
            onChange={e => setNotation(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="2d6+3"
            spellCheck={false}
            className={`h-9 w-full rounded-md border px-2.5 pr-8 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring ${t.field} ${
              dirty && !valid ? t.invalid : ''
            }`}
          />
          {dirty && (
            <button
              type="button"
              onClick={() => setNotation('')}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${t.muted}`}
              title="Effacer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Perception"
          className={`h-9 w-32 rounded-md border px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${t.field}`}
        />
      </div>

      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={submit}
          disabled={!valid || pending}
          className={`h-9 flex-1 rounded-md px-3 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:pointer-events-none ${t.roll}`}
        >
          <Dices className="h-4 w-4" />
          {pending ? 'Jet en cours…' : 'Lancer'}
        </button>
      </div>

      {dirty && !valid && (
        <p className={`text-[11px] ${t.muted}`}>
          Notation invalide. Exemples : <span className="font-mono">1d20+5</span>,{' '}
          <span className="font-mono">2d6</span>, <span className="font-mono">4d6kh3</span>.
        </p>
      )}
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
    </div>
  )
}
