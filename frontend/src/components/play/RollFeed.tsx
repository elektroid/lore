import { EyeOff } from 'lucide-react'
import { relativeTime } from '@/lib/dice'
import type { Roll } from '@/types/table'

/**
 * `app` follows the theme tokens (GM console). `stage` is a fixed dark palette
 * for the public surfaces — a projection screen is shown in a dark room, not in
 * whatever theme the GM happens to have picked.
 */
export type Tone = 'app' | 'stage'

const TONE = {
  app: {
    row: 'border-border bg-card',
    actor: 'text-foreground',
    label: 'text-muted-foreground',
    detail: 'text-muted-foreground',
    total: 'text-foreground',
    empty: 'text-muted-foreground',
  },
  stage: {
    row: 'border-white/10 bg-white/5',
    actor: 'text-white',
    label: 'text-white/60',
    detail: 'text-white/40',
    total: 'text-white',
    empty: 'text-white/40',
  },
} as const

export default function RollFeed({
  rolls, tone = 'app', limit, empty = 'Aucun jet pour le moment.',
}: {
  rolls: Roll[]
  tone?: Tone
  limit?: number
  empty?: string
}) {
  const t = TONE[tone]
  const shown = limit ? rolls.slice(0, limit) : rolls

  if (shown.length === 0) {
    return <p className={`text-xs italic ${t.empty}`}>{empty}</p>
  }

  return (
    <ul className="space-y-1.5">
      {shown.map(roll => (
        <li key={roll.id} className={`flex items-center gap-3 rounded-md border px-2.5 py-1.5 ${t.row}`}>
          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium truncate">
              {roll.secret && <EyeOff className={`h-3 w-3 shrink-0 ${t.label}`} />}
              <span className={t.actor}>{roll.actor}</span>
              {roll.label && <span className={`truncate font-normal ${t.label}`}>· {roll.label}</span>}
            </p>
            <p className={`text-[11px] font-mono truncate ${t.detail}`} title={roll.detail}>
              {roll.detail}
            </p>
          </div>
          <span className={`shrink-0 text-lg font-semibold tabular-nums ${t.total}`}>{roll.total}</span>
          <span className={`shrink-0 text-[10px] w-16 text-right ${t.detail}`}>
            {relativeTime(roll.created_at)}
          </span>
        </li>
      ))}
    </ul>
  )
}
