import { useState } from 'react'
import { ChevronDown, UserRound, X } from 'lucide-react'

interface NPCCardNPC {
  id: string
  name: string
  role: string
  description: string
  quote: string
  motivation: string
  images?: string
}

interface Props {
  npc: NPCCardNPC
  onEdit: () => void
  onRemove?: () => void
}

export default function NPCCard({ npc, onEdit, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false)
  const images: { url: string }[] = (() => { try { return JSON.parse(npc.images || '[]') } catch { return [] } })()
  const portrait = images[0] ?? null

  return (
    <div className="rounded-md border bg-card p-3 space-y-1">
      <div className="flex items-start gap-2">
        {portrait ? (
          <img src={portrait.url} alt={npc.name} className="h-8 w-8 rounded-full object-cover shrink-0 mt-0.5" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted shrink-0 flex items-center justify-center mt-0.5">
            <UserRound className="h-4 w-4 text-muted-foreground/40" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <button onClick={onEdit} className="text-sm font-medium truncate hover:underline text-left w-full">{npc.name}</button>
          {npc.role && <p className="text-xs text-muted-foreground">{npc.role}</p>}
          {npc.motivation && <p className="text-xs text-primary/80 mt-0.5 italic">{npc.motivation}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          {(npc.description || npc.quote) && (
            <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground hover:text-foreground p-0.5">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} className="text-muted-foreground/40 hover:text-destructive p-0.5">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="space-y-1 pt-1 border-t mt-1">
          {npc.description && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{npc.description}</p>}
          {npc.quote && <p className="text-xs italic text-muted-foreground">«{npc.quote}»</p>}
        </div>
      )}
    </div>
  )
}
