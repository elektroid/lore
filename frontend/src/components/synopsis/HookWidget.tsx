import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import StatusBadge from './StatusBadge'
import MentionEditor from './MentionEditor'
import { useSynopsisLLM } from '@/hooks/useSynopsisLLM'
import type { HookData, SynopsisData } from '@/types/synopsis'

interface Props {
  scenarioId: string
  campaignId: string
  hook: HookData
  onChange: (data: Partial<SynopsisData>) => void
}

export default function HookWidget({ scenarioId, campaignId, hook, onChange }: Props) {
  const llm = useSynopsisLLM(scenarioId)
  const locked = hook.status === 'confirmed'

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Synopsis</h3>
        <StatusBadge
          status={hook.status}
          onChange={status => onChange({ hook: { ...hook, status } })}
        />
      </div>
      <MentionEditor
        campaignId={campaignId}
        value={hook.content}
        onChange={content => onChange({ hook: { ...hook, content } })}
        placeholder="Une idée même vague… ex : 'Les PJs sont engagés pour récupérer un prototype, mais quelqu'un d'autre le veut aussi'"
        disabled={locked || llm.completeHook.isPending}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={locked || llm.completeHook.isPending}
          onClick={() => llm.completeHook.mutate()}
        >
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          {llm.completeHook.isPending ? 'Génération…' : 'Compléter avec le LLM'}
        </Button>
        {llm.completeHook.isError && (
          <p className="text-xs text-destructive">{(llm.completeHook.error as Error).message}</p>
        )}
      </div>
    </section>
  )
}
