import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppShell from '@/components/AppShell'
import RunsSection from '@/components/RunsSection'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useSyncMode } from '@/hooks/useSyncMode'
import { api } from '@/api/client'
import type { Campaign } from '@/types/campaign'
import type { Scenario } from '@/types/scenario'

/** Quick launch into a scenario's live console — the GM picks the group there. */
function ScenarioLaunchList({ campaignId }: { campaignId: string }) {
  const { data: scenarios = [] } = useQuery({
    queryKey: ['scenarios', campaignId],
    queryFn: () => api.get<Scenario[]>(`/campaigns/${campaignId}/scenarios`),
  })

  if (scenarios.length === 0) return null

  return (
    <div className="space-y-3 pt-6 border-t">
      <p className="text-sm font-medium">Lancer une session</p>
      <ul className="space-y-1.5">
        {scenarios.map(s => (
          <Link
            key={s.id}
            to={`/scenarios/${s.id}/play`}
            className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors"
          >
            <Play className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-sm font-medium">{s.name}</span>
          </Link>
        ))}
      </ul>
    </div>
  )
}

/**
 * The Meneur (Gamemaster) hub: prepare and manage the groups playing this
 * campaign — create a run, seat its party, then jump into a live session from
 * PlayPage. See docs/adr/0001-runs-separate-story-from-play.md.
 */
export default function GameMasterPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get<Campaign>(`/campaigns/${id}`),
  })

  useDocTitle(campaign ? `lore: ${campaign.name} · Meneur` : 'lore')
  useSyncMode('gamemaster')

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground text-sm">Chargement…</p>
        </div>
      </AppShell>
    )
  }

  if (error || !campaign) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <p className="text-destructive text-sm">{error?.message ?? 'Campagne introuvable'}</p>
          <Button variant="outline" onClick={() => navigate('/')}>Retour aux campagnes</Button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      crumbs={[{ label: campaign.name, to: `/campaigns/${id}` }, { label: 'Meneur' }]}
    >
      <main className="max-w-3xl mx-auto px-6 py-8">
        <RunsSection campaignId={id!} />
        <ScenarioLaunchList campaignId={id!} />
      </main>
    </AppShell>
  )
}
