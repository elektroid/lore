import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dices, Eye, EyeOff } from 'lucide-react'
import { api } from '@/api/client'
import DiceRoller from './DiceRoller'
import RollFeed from './RollFeed'
import type { Roll } from '@/types/table'

/**
 * The GM's dice, and the session's full roll log — secret rolls included, which
 * is why this reads the authenticated endpoint rather than the table stream.
 *
 * A secret roll is withheld server-side: it is never published to the hub, so it
 * cannot leak to a table screen through a client-side filter mistake.
 */
export default function GMDiceTray({
  scenarioId, sessionId,
}: {
  scenarioId: string
  sessionId: string
}) {
  const qc = useQueryClient()
  const [secret, setSecret] = useState(false)

  const { data: rolls = [] } = useQuery({
    queryKey: ['session-rolls', sessionId],
    queryFn: () => api.get<Roll[]>(`/scenarios/${scenarioId}/sessions/${sessionId}/rolls`),
    enabled: !!sessionId,
  })

  const roll = useMutation({
    mutationFn: (v: { notation: string; label: string }) =>
      api.post<Roll>(`/scenarios/${scenarioId}/sessions/${sessionId}/rolls`, { ...v, secret }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-rolls', sessionId] }),
  })

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Dices className="h-4 w-4 text-muted-foreground" />
        Dés
      </h3>

      <DiceRoller
        pending={roll.isPending}
        error={roll.error?.message ?? null}
        onRoll={(notation, label) => roll.mutate({ notation, label })}
      >
        <button
          type="button"
          onClick={() => setSecret(s => !s)}
          title={secret ? 'Jet secret — invisible pour la table' : 'Jet public — visible par tous'}
          className={`h-9 shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${
            secret
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-600'
              : 'border-input hover:bg-accent text-muted-foreground'
          }`}
        >
          {secret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {secret ? 'Secret' : 'Public'}
        </button>
      </DiceRoller>

      <div className="space-y-2 pt-1">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Journal</p>
        <div className="max-h-72 overflow-y-auto pr-0.5">
          <RollFeed rolls={rolls} limit={30} empty="Aucun jet dans cette session." />
        </div>
      </div>
    </div>
  )
}
