import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Dices, WifiOff } from 'lucide-react'
import RollFeed from '@/components/play/RollFeed'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useTableStream } from '@/hooks/useTableStream'
import type { Roll } from '@/types/table'

const FLASH_MS = 4500
const CURSOR_IDLE_MS = 3000

/**
 * The table screen — the TV in the room, or the tab a remote group keeps open.
 *
 * Read-only by construction: it renders the session's current projection and the
 * public roll feed, and knows nothing else about the scenario. Nothing appears
 * here unless the GM put it here. See docs/play-table.md.
 */
export default function TablePage() {
  const { token = '' } = useParams<{ token: string }>()

  const [flash, setFlash] = useState<Roll | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onRoll = useCallback((roll: Roll) => {
    setFlash(roll)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
  }, [])

  const { snapshot, status, error } = useTableStream(token, { onRoll })
  const cursorHidden = useIdleCursor()

  useDocTitle(snapshot ? `Table — ${snapshot.session_name}` : 'Table')

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  if (error) {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg">Ce lien de table n'est plus valide.</p>
        <p className="text-sm text-white/50">Demandez au MJ de vous renvoyer le lien de la session.</p>
      </div>
    )
  }

  const projection = snapshot?.projection

  return (
    <div className={`fixed inset-0 bg-black text-white overflow-hidden ${cursorHidden ? 'cursor-none' : ''}`}>

      {/* ── Projection ─────────────────────────────────────────────────────── */}
      {projection?.kind === 'image' && projection.url && (
        <div className="absolute inset-0">
          {/* Blurred copy fills the letterbox bars rather than leaving black voids */}
          <div
            className="absolute inset-0 bg-cover bg-center blur-3xl scale-110 opacity-25"
            style={{ backgroundImage: `url(${projection.url})` }}
          />
          <img
            key={projection.url}
            src={projection.url}
            alt={projection.title || ''}
            className="relative h-full w-full object-contain animate-stage-in"
          />
          {(projection.title || projection.subtitle) && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-10 pt-24 pb-8">
              {projection.title && (
                <h1 className="text-4xl font-semibold tracking-tight">{projection.title}</h1>
              )}
              {projection.subtitle && (
                <p className="mt-1 text-lg text-white/60">{projection.subtitle}</p>
              )}
            </div>
          )}
        </div>
      )}

      {projection?.kind === 'text' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-16 text-center animate-stage-in">
          <h1 className="text-6xl font-semibold tracking-tight leading-tight">{projection.title}</h1>
          {projection.subtitle && (
            <p className="mt-6 text-2xl text-white/50">{projection.subtitle}</p>
          )}
        </div>
      )}

      {(!projection || projection.kind === '') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-10">
          <p className="text-xs uppercase tracking-[0.3em] text-white/30">
            {snapshot?.campaign_name ?? ''}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white/80">
            {snapshot?.session_name ?? 'Table'}
          </h1>
          <p className="text-sm text-white/30 mt-2">{snapshot?.scenario_name}</p>
        </div>
      )}

      {/* ── Latest roll, briefly and loudly ────────────────────────────────── */}
      {flash && (
        <div
          key={flash.id}
          className="absolute top-10 left-1/2 -translate-x-1/2 flex items-center gap-5 rounded-2xl border border-white/15 bg-black/80 backdrop-blur px-8 py-5 shadow-2xl animate-roll-in"
        >
          <div className="text-right">
            <p className="text-lg font-medium">{flash.actor}</p>
            {flash.label && <p className="text-sm text-white/50">{flash.label}</p>}
            <p className="text-xs font-mono text-white/35 mt-0.5">{flash.detail}</p>
          </div>
          <span className="text-7xl font-bold tabular-nums leading-none">{flash.total}</span>
        </div>
      )}

      {/* ── Roll feed ──────────────────────────────────────────────────────── */}
      {snapshot && snapshot.rolls.length > 0 && (
        <div className="absolute bottom-6 right-6 w-80 rounded-xl border border-white/10 bg-black/60 backdrop-blur p-3">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/35 mb-2">
            <Dices className="h-3 w-3" />
            Jets
          </p>
          <RollFeed rolls={snapshot.rolls} tone="stage" limit={5} />
        </div>
      )}

      {/* ── Connection ─────────────────────────────────────────────────────── */}
      {status !== 'live' && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white/50">
          <WifiOff className="h-3 w-3" />
          {status === 'connecting' ? 'Connexion…' : 'Reconnexion…'}
        </div>
      )}
    </div>
  )
}

/** Hides the pointer once the room stops touching the projection machine. */
function useIdleCursor() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function wake() {
      setHidden(false)
      clearTimeout(timer)
      timer = setTimeout(() => setHidden(true), CURSOR_IDLE_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      clearTimeout(timer)
    }
  }, [])

  return hidden
}
