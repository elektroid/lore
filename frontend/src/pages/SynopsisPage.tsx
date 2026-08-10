import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, X, Sparkles, Printer, Play, BookOpen, FolderOpen, Users } from 'lucide-react'
import AppShell from '@/components/AppShell'
import HookWidget from '@/components/synopsis/HookWidget'
import FactionWidget from '@/components/synopsis/FactionWidget'
import SceneList from '@/components/synopsis/SceneList'
import SceneDetail from '@/components/synopsis/SceneDetail'
import BetweenScenesPanel from '@/components/synopsis/BetweenScenesPanel'
import BrainstormDrawer from '@/components/synopsis/BrainstormDrawer'
import { useSynopsis } from '@/hooks/useSynopsis'
import { useDocTitle } from '@/hooks/useDocTitle'
import { api } from '@/api/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Campaign } from '@/types/campaign'
import type { Scenario } from '@/types/scenario'
import type { Scene, SynopsisData } from '@/types/synopsis'
import type { GameDocument } from '@/types/game'
import type { Run } from '@/types/run'

function DocumentsDialog({ gameId, gameName, onClose }: { gameId: string; gameName: string; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['game-documents', gameId],
    queryFn: () => api.get<GameDocument[]>(`/games/${gameId}/documents`),
    enabled: !!gameId,
  })

  const filtered = search.trim()
    ? docs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
    : docs

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {gameName}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Chargement…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Aucun document trouvé pour ce jeu.</p>
        ) : (
          <div className="space-y-2">
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <ul className="space-y-0.5 max-h-80 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-2">Aucun résultat.</p>
              ) : filtered.map(d => (
                <li key={d.url}>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function SynopsisPage() {
  const { id } = useParams<{ id: string }>()
  const scenarioId = id!
  const navigate = useNavigate()

  const { data: scenario } = useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => api.get<Scenario>(`/scenarios/${scenarioId}`),
  })

  const { data: campaign } = useQuery({
    queryKey: ['campaign', scenario?.campaign_id],
    queryFn: () => api.get<Campaign>(`/campaigns/${scenario!.campaign_id}`),
    enabled: !!scenario?.campaign_id,
  })

  const { query, parsed, save, isSaving } = useSynopsis(scenarioId)
  const [selectedSceneId, setSelectedSceneId] = useState<string>('')
  const [hookCollapsed, setHookCollapsed] = useState(false)
  const [brainstormOpen, setBrainstormOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)

  // The run lens. Empty by default, and that default is the point: the synopsis
  // is the story, and the story is the same for every group that plays it.
  // Picking a group overlays how far *they* have got, without changing a word.
  // See docs/adr/0001-runs-separate-story-from-play.md.
  const [lensRunId, setLensRunId] = useState('')

  const { data: runs = [] } = useQuery({
    queryKey: ['runs', scenario?.campaign_id],
    queryFn: () => api.get<Run[]>(`/campaigns/${scenario!.campaign_id}/runs`),
    enabled: !!scenario?.campaign_id,
  })

  const { data: sceneStates = {} } = useQuery({
    queryKey: ['run-scenes', lensRunId, scenarioId],
    queryFn: () => api.get<Record<string, string>>(`/scenarios/${scenarioId}/runs/${lensRunId}/scenes`),
    enabled: !!lensRunId,
  })

  useDocTitle(scenario ? `lore: ${scenario.name}` : 'lore')

  function onChange(patch: Partial<SynopsisData>) {
    if (!parsed) return
    save({ ...parsed, ...patch })
  }

  function onChangeImmediate(patch: Partial<SynopsisData>) {
    if (!parsed) return
    save({ ...parsed, ...patch }, true)
  }

  // Find selected scene from query cache
  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', scenarioId],
    queryFn: () => api.get<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes`),
  })

  const selectedScene = scenes.find(s => s.id === selectedSceneId) ?? null

  useEffect(() => {
    if (!selectedSceneId) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedSceneId('') }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedSceneId])

  // Writing the story is authoring — owner-only, even for a delegated
  // gamemaster (who runs sessions from PlayPage instead, which reads the
  // synopsis it needs without exposing these editing controls). See
  // AccessSection in CampaignDetailPage.tsx.
  if (campaign && campaign.access !== 'owner') {
    navigate(`/campaigns/${campaign.id}/runs`, { replace: true })
    return null
  }

  return (
    <>
    <AppShell
      crumbs={[
        { label: campaign?.name ?? '…', to: campaign ? `/campaigns/${campaign.id}` : undefined },
        selectedScene
          ? { label: scenario?.name ?? '…', onClick: () => setSelectedSceneId('') }
          : { label: scenario?.name ?? '…' },
        selectedScene
          ? { label: selectedScene.title }
          : { label: 'Synopsis' },
      ]}
      modeTabs={campaign ? [
        { label: 'Auteur', to: `/campaigns/${campaign.id}`, active: true },
        { label: 'Meneur', to: `/campaigns/${campaign.id}/runs`, active: false },
      ] : undefined}
    >
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          {isSaving && <span className="text-xs text-muted-foreground">Sauvegarde…</span>}
          <div className="ml-auto flex items-center gap-2">
            {runs.length > 0 && (
              <div
                className="flex items-center gap-1.5 text-xs pl-2 pr-1 py-1 rounded-md border border-border text-muted-foreground"
                title="Afficher la progression d'un groupe par-dessus le scénario"
              >
                <Users className="h-3.5 w-3.5" />
                <select
                  value={lensRunId}
                  onChange={e => setLensRunId(e.target.value)}
                  className="bg-transparent text-xs py-0.5 pr-1 focus:outline-none"
                >
                  <option value="">Scénario seul</option>
                  {runs.map(r => (
                    <option key={r.id} value={r.id}>Progression : {r.name}</option>
                  ))}
                </select>
              </div>
            )}
            <a
              href={`/scenarios/${scenarioId}/play${lensRunId ? `?run=${lensRunId}` : ''}`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
              Play
            </a>
            <a
              href={`/scenarios/${scenarioId}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimer
            </a>
            {campaign?.game_id && (
              <button
                onClick={() => setDocsOpen(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  docsOpen
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground hover:text-foreground border-border hover:bg-accent'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Documents
              </button>
            )}
            <button
              onClick={() => setBrainstormOpen(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors ${
                brainstormOpen
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:text-foreground border-border hover:bg-accent'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Brainstorm
            </button>
          </div>
        </div>

        {/* Hook (collapsible) */}
        {query.isLoading ? (
          <p className="text-muted-foreground text-sm">Chargement…</p>
        ) : parsed && (
          <div className="rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => setHookCollapsed(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent/30 transition-colors rounded-lg"
            >
              <span>Synopsis</span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${hookCollapsed ? '-rotate-90' : ''}`} />
            </button>
            {!hookCollapsed && (
              <div className="px-4 pb-4 space-y-6">
                <HookWidget
                  scenarioId={scenarioId}
                  campaignId={scenario?.campaign_id ?? ''}
                  hook={parsed.hook}
                  onChange={onChange}
                />
                <FactionWidget
                  scenarioId={scenarioId}
                  campaignId={scenario?.campaign_id ?? ''}
                />
              </div>
            )}
          </div>
        )}

        {/* Split view */}
        <div className="grid grid-cols-[280px_1fr] gap-6 min-h-[60vh]">
          {/* Left — scene list */}
          <div className="rounded-lg border bg-card p-4 flex flex-col">
            <SceneList
              scenarioId={scenarioId}
              selectedId={selectedSceneId}
              onSelect={id => setSelectedSceneId(id === selectedSceneId ? '' : id)}
              sceneStates={sceneStates}
            />
          </div>

          {/* Right — detail or between-scenes */}
          <div className="rounded-lg border bg-card p-4 overflow-y-auto max-h-[80vh]">
            {selectedScene && selectedScene.type === 'scene' ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Scène</span>
                  <button
                    onClick={() => setSelectedSceneId('')}
                    className="text-muted-foreground/40 hover:text-muted-foreground p-0.5"
                    title="Fermer (Échap)"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <SceneDetail
                  scenarioId={scenarioId}
                  campaignId={scenario?.campaign_id ?? ''}
                  scene={selectedScene}
                />
              </div>
            ) : (
              <div className="space-y-6">
                <BetweenScenesPanel
                  scenarioId={scenarioId}
                  campaignId={scenario?.campaign_id ?? ''}
                  synopsis={query.data}
                  onSelectScene={setSelectedSceneId}
                  sceneStates={sceneStates}
                  lensRunName={runs.find(r => r.id === lensRunId)?.name ?? ''}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>

    {brainstormOpen && (
      <BrainstormDrawer
        scenarioId={scenarioId}
        onClose={() => setBrainstormOpen(false)}
      />
    )}
    {docsOpen && campaign?.game_id && (
      <DocumentsDialog
        gameId={campaign.game_id}
        gameName={campaign.game_name}
        onClose={() => setDocsOpen(false)}
      />
    )}
    </>
  )
}
