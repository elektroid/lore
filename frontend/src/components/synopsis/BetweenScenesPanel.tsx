import { useState } from 'react'
import { Sparkles, Lightbulb } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useSynopsisLLM } from '@/hooks/useSynopsisLLM'
import NPCEditorModal from '@/components/NPCEditorModal'
import ImprovPanel from '@/components/play/ImprovPanel'
import NPCCard from './NPCCard'
import type { Scene, Synopsis, SynopsisNPC } from '@/types/synopsis'
import type { SessionBeat } from '@/types/beat'
import { api } from '@/api/client'

interface Props {
  scenarioId: string
  campaignId: string
  synopsis: Synopsis | undefined
}

// ── Coming up card (compact) ──────────────────────────────────────────────────

function ComingUpCard({ scene, onSelect }: { scene: Scene; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-md border bg-card hover:bg-accent/50 transition-colors px-3 py-2 space-y-0.5"
    >
      <p className="text-sm font-medium truncate">{scene.title || <span className="italic text-muted-foreground">Sans titre</span>}</p>
      {scene.location_name && <p className="text-xs text-muted-foreground">{scene.location_name}</p>}
      {scene.description && <p className="text-xs text-muted-foreground line-clamp-2">{scene.description}</p>}
    </button>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function BetweenScenesPanel({ scenarioId, campaignId, synopsis, onSelectScene }: Props & { onSelectScene: (id: string) => void }) {
  const llm = useSynopsisLLM(scenarioId)
  const [editNpcId, setEditNpcId] = useState<string | null>(null)

  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', scenarioId],
    queryFn: () => api.get<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes`),
  })

  const { data: npcs = [] } = useQuery({
    queryKey: ['synopsis-npcs', scenarioId],
    queryFn: () => api.get<SynopsisNPC[]>(`/scenarios/${scenarioId}/synopsis/npcs`),
  })

  // Every session's improvised beats, not just the last one — prep for session 4
  // opens with what the players invented in sessions 1 to 3 and nobody has
  // folded in yet. See docs/play-improv.md.
  const { data: beats = [] } = useQuery({
    queryKey: ['beats', scenarioId, 'all'],
    queryFn: () => api.get<SessionBeat[]>(`/scenarios/${scenarioId}/beats`),
  })
  const openBeats = beats.filter(b => b.status === 'captured' || b.status === 'developed').length

  const upcoming = scenes.filter(s => s.type === 'scene' && !s.played).slice(0, 3)

  return (
    <div className="space-y-6">
      {/* What the players invented and nobody has folded in yet */}
      {beats.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">
              Impros des sessions
            </p>
            {openBeats > 0 && (
              <span className="rounded-full px-1.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                {openBeats} à traiter
              </span>
            )}
          </div>
          <ImprovPanel scenarioId={scenarioId} onOpenScene={onSelectScene} />
        </section>
      )}

      {/* Coming up */}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">À venir</p>
          <div className="space-y-2">
            {upcoming.map(s => (
              <ComingUpCard key={s.id} scene={s} onSelect={() => onSelectScene(s.id)} />
            ))}
          </div>
        </section>
      )}

      {upcoming.length === 0 && scenes.length > 0 && (
        <p className="text-sm text-muted-foreground">Toutes les scènes sont jouées.</p>
      )}

      {/* Overview */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">Overview</p>
          <Button
            size="sm" variant="ghost" className="h-6 px-2 text-xs"
            disabled={llm.generateOverview.isPending}
            onClick={() => llm.generateOverview.mutate()}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            {llm.generateOverview.isPending ? 'Génération…' : synopsis?.overview_cache ? 'Regénérer' : 'Générer'}
          </Button>
        </div>
        {synopsis?.overview_cache ? (
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{synopsis.overview_cache}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Aucun overview — cliquez sur Générer.</p>
        )}
        {llm.generateOverview.isError && (
          <p className="text-xs text-destructive">{(llm.generateOverview.error as Error).message}</p>
        )}
      </section>

      {/* Cast */}
      {npcs.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Distribution</p>
          <div className="space-y-2">
            {npcs.map(npc => <NPCCard key={npc.id} npc={npc} onEdit={() => setEditNpcId(npc.id)} />)}
          </div>
        </section>
      )}

      {editNpcId && (
        <NPCEditorModal
          npcId={editNpcId}
          campaignId={campaignId}
          open={!!editNpcId}
          onClose={() => setEditNpcId(null)}
        />
      )}
    </div>
  )
}
