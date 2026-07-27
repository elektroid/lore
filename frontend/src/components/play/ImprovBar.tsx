import { useEffect, useRef, useState } from 'react'
import { Zap, Check, Lightbulb } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { SessionBeat } from '@/types/beat'

interface Props {
  scenarioId: string
  sessionId: string
  anchorTitle: string
  openCount: number
  panelOpen: boolean
  onTogglePanel: () => void
}

// ── Capture ───────────────────────────────────────────────────────────────────
//
// The whole point of this component is that it costs three seconds. One field,
// Enter, done — no modal, no LLM, no spinner in the way. The GM is mid-sentence
// at a table; everything else waits until they are not.
// See docs/play-improv.md.

export default function ImprovBar({
  scenarioId, sessionId, anchorTitle, openCount, panelOpen, onTogglePanel,
}: Props) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const capture = useMutation({
    mutationFn: (n: string) =>
      api.post<SessionBeat>(`/scenarios/${scenarioId}/beats`, { session_id: sessionId, note: n }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beats', scenarioId] })
      setFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(false), 1400)
    },
  })

  // The field clears the moment Enter lands, before the request resolves. A GM
  // who types two things in a row must never wait on the first.
  function submit() {
    const n = note.trim()
    if (!n) return
    setNote('')
    capture.mutate(n)
  }

  // Ctrl/Cmd+I focuses the field from anywhere on the console, so capturing
  // never costs a trip to the mouse.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Zap className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-500 pointer-events-none" />
        <input
          ref={inputRef}
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Impro — ce que les joueurs inventent… (Entrée pour noter, Ctrl+I pour venir ici)"
          className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-24 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {flash && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 pointer-events-none">
            <Check className="h-3.5 w-3.5" />
            noté
          </span>
        )}
        {!flash && anchorTitle && (
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground truncate max-w-[40%] pointer-events-none"
            title={`Sera rattachée à « ${anchorTitle} »`}
          >
            ↳ {anchorTitle}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onTogglePanel}
        className={`flex items-center gap-1.5 text-xs px-2.5 h-9 rounded border transition-colors shrink-0 ${
          panelOpen
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title="Impros de la campagne"
      >
        <Lightbulb className="h-3.5 w-3.5" />
        Impros
        {openCount > 0 && (
          <span className={`rounded-full px-1.5 text-[10px] font-semibold ${
            panelOpen ? 'bg-primary-foreground/20' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          }`}>
            {openCount}
          </span>
        )}
      </button>

      {capture.isError && (
        <span className="text-xs text-destructive shrink-0">{(capture.error as Error).message}</span>
      )}
    </div>
  )
}
