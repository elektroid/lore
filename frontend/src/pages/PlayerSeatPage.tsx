import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Dices, UserRound, WifiOff } from 'lucide-react'
import { api } from '@/api/client'
import DiceRoller from '@/components/play/DiceRoller'
import RollFeed from '@/components/play/RollFeed'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useTableStream } from '@/hooks/useTableStream'
import type { Roll } from '@/types/table'

const seatKey = (token: string) => `lore.seat.${token}`

/**
 * A player's own device — phone at the table, or browser tab when playing
 * remotely. Same link as the table screen with /player appended.
 *
 * No account: the player claims a seat by name, kept in localStorage. See
 * docs/play-table.md for why, and what that costs.
 */
export default function PlayerSeatPage() {
  const { token = '' } = useParams<{ token: string }>()

  const [seat, setSeat] = useState(() => localStorage.getItem(seatKey(token)) ?? '')
  const [claiming, setClaiming] = useState(!seat)

  const { snapshot, status, error } = useTableStream(token)

  useDocTitle(snapshot ? `${seat || 'Joueur'} — ${snapshot.session_name}` : 'Table')

  const claim = useCallback((name: string) => {
    const clean = name.trim().slice(0, 60)
    if (!clean) return
    localStorage.setItem(seatKey(token), clean)
    setSeat(clean)
    setClaiming(false)
  }, [token])

  const roll = useMutation({
    mutationFn: (v: { notation: string; label: string }) =>
      api.post<Roll>(`/table/${token}/rolls`, { actor: seat, ...v }),
  })

  if (error) {
    return (
      <Stage>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
          <p className="text-lg">Ce lien n'est plus valide.</p>
          <p className="text-sm text-white/50">Demandez au MJ de vous renvoyer le lien de la session.</p>
        </div>
      </Stage>
    )
  }

  if (claiming || !seat) {
    return (
      <Stage>
        <SeatPicker
          seats={snapshot?.seats.map(s => s.name) ?? []}
          sessionName={snapshot?.session_name ?? ''}
          current={seat}
          onClaim={claim}
        />
      </Stage>
    )
  }

  const projection = snapshot?.projection

  return (
    <Stage>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/40 truncate">{snapshot?.campaign_name}</p>
          <h1 className="text-sm font-medium truncate">{snapshot?.session_name}</h1>
        </div>
        {status !== 'live' && <WifiOff className="h-3.5 w-3.5 text-white/40 shrink-0" />}
        <button
          onClick={() => setClaiming(true)}
          className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10 transition-colors shrink-0"
        >
          <UserRound className="h-3.5 w-3.5" />
          {seat}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* What the GM is showing — the same image as the room's screen */}
        {projection?.kind === 'image' && projection.url && (
          <figure className="border-b border-white/10">
            <img
              key={projection.url}
              src={projection.url}
              alt={projection.title || ''}
              className="w-full max-h-64 object-contain bg-black animate-stage-in"
            />
            {(projection.title || projection.subtitle) && (
              <figcaption className="px-4 py-2">
                <p className="text-sm font-medium">{projection.title}</p>
                {projection.subtitle && <p className="text-xs text-white/40">{projection.subtitle}</p>}
              </figcaption>
            )}
          </figure>
        )}

        {projection?.kind === 'text' && (
          <div className="border-b border-white/10 px-4 py-8 text-center animate-stage-in">
            <p className="text-2xl font-semibold">{projection.title}</p>
            {projection.subtitle && <p className="mt-1 text-sm text-white/40">{projection.subtitle}</p>}
          </div>
        )}

        <div className="p-4 space-y-5">
          <DiceRoller
            tone="stage"
            pending={roll.isPending}
            error={roll.error?.message ?? null}
            onRoll={(notation, label) => roll.mutate({ notation, label })}
          />

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/35">
              <Dices className="h-3 w-3" />
              Jets de la table
            </p>
            <RollFeed
              rolls={snapshot?.rolls ?? []}
              tone="stage"
              limit={20}
              empty="Personne n'a encore lancé."
            />
          </div>
        </div>
      </div>
    </Stage>
  )
}

/** The public surfaces own their palette — they are looked at in a dark room. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-950 text-white">{children}</div>
  )
}

function SeatPicker({
  seats, sessionName, current, onClaim,
}: {
  seats: string[]
  sessionName: string
  current: string
  onClaim: (name: string) => void
}) {
  // The picker is unmounted the moment a seat is claimed, so `current` never
  // changes underneath it — seeding the field once is enough.
  const [custom, setCustom] = useState(current)

  return (
    <div className="flex-1 flex flex-col justify-center gap-5 px-6 max-w-sm mx-auto w-full">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-white/30">{sessionName}</p>
        <h1 className="mt-2 text-xl font-semibold">Qui joue sur cet écran ?</h1>
      </div>

      {seats.length > 0 && (
        <ul className="space-y-1.5">
          {seats.map(name => (
            <li key={name}>
              <button
                onClick={() => onClaim(name)}
                className={`w-full rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                  name === current
                    ? 'border-white/40 bg-white/10'
                    : 'border-white/15 bg-white/5 hover:bg-white/10'
                }`}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        {seats.length > 0 && (
          <p className="text-[11px] text-white/30 text-center">ou entrez un autre nom</p>
        )}
        <div className="flex gap-1.5">
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onClaim(custom)}
            placeholder="Votre nom"
            maxLength={60}
            className="h-10 flex-1 rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
          />
          <button
            onClick={() => onClaim(custom)}
            disabled={!custom.trim()}
            className="h-10 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40 disabled:pointer-events-none"
          >
            Entrer
          </button>
        </div>
      </div>
    </div>
  )
}
