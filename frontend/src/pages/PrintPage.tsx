import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Scenario } from '@/types/scenario'
import type { Campaign } from '@/types/campaign'
import type { Synopsis, SynopsisNPC, Scene } from '@/types/synopsis'
import { stripMentions } from '@/lib/mentions'
import { parseRichText, type InlineRun } from '@/lib/richtext'

function renderRun(run: InlineRun, key: number) {
  if (run.type === 'bold') return <strong key={key}>{run.text}</strong>
  if (run.type === 'italic') return <em key={key}>{run.text}</em>
  // Mentions were already flattened to `@Name` before parsing — see printProse.
  return <span key={key}>{run.type === 'text' ? run.text : run.storedName}</span>
}

/**
 * Fields authored through MentionEditor may carry `**bold**` / `- list`
 * markers (see lib/richtext.ts) alongside mentions. A print sheet has no
 * entity list to resolve mentions against, so flatten those to `@Name` first,
 * same as before, then render the formatting on top.
 */
function PrintProse({ text, className }: { text: string; className?: string }) {
  const blocks = parseRichText(stripMentions(text))
  return (
    <div className={className}>
      {blocks.map((block, bi) => block.type === 'list' ? (
        <ul key={bi} className="list-disc pl-5 mb-1 last:mb-0">
          {block.items.map((runs, li) => <li key={li}>{runs.map(renderRun)}</li>)}
        </ul>
      ) : (
        <p key={bi} className="mb-1 last:mb-0">
          {block.lines.map((runs, li) => (
            <span key={li}>{li > 0 && <br />}{runs.map(renderRun)}</span>
          ))}
        </p>
      ))}
    </div>
  )
}

function firstImage(imagesJson: string): string | null {
  try {
    const arr: { url: string }[] = JSON.parse(imagesJson || '[]')
    return arr[0]?.url ?? null
  } catch { return null }
}

const STATUS_LABEL: Record<string, string> = {
  idea: 'Idée',
  optional_step: 'Étape optionnelle',
  key_event: 'Événement clé',
}

const STATUS_CLASS: Record<string, string> = {
  idea:          'print-badge--idea',
  optional_step: 'print-badge--optional',
  key_event:     'print-badge--key',
}

export default function PrintPage() {
  const { id } = useParams<{ id: string }>()
  const scenarioId = id!

  const { data: scenario } = useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => api.get<Scenario>(`/scenarios/${scenarioId}`),
  })

  const { data: campaign } = useQuery({
    queryKey: ['campaign', scenario?.campaign_id],
    queryFn: () => api.get<Campaign>(`/campaigns/${scenario!.campaign_id}`),
    enabled: !!scenario?.campaign_id,
  })

  const { data: synopsis } = useQuery({
    queryKey: ['synopsis', scenarioId],
    queryFn: () => api.get<Synopsis>(`/scenarios/${scenarioId}/synopsis`),
  })

  const { data: npcs = [] } = useQuery({
    queryKey: ['synopsis-npcs', scenarioId],
    queryFn: () => api.get<SynopsisNPC[]>(`/scenarios/${scenarioId}/synopsis/npcs`),
  })

  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', scenarioId],
    queryFn: () => api.get<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes`),
  })

  const allLoaded = !!(scenario && campaign && synopsis)

  useEffect(() => {
    if (allLoaded) {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [allLoaded])

  if (!allLoaded) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-gray-500">
        Préparation du document…
      </div>
    )
  }

  let hookContent = ''
  try { hookContent = JSON.parse(synopsis.hook)?.content ?? '' } catch {}

  const visibleScenes = scenes.filter(s => s.type === 'scene')

  return (
    <div className="print-page">
      {/* Header */}
      <header className="print-header">
        <div className="print-campaign">{campaign.name}</div>
        <h1 className="print-title">{scenario.name}</h1>
        <div className="print-date">
          Exporté le {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </header>

      <hr className="print-rule" />

      {/* Overview */}
      {synopsis.overview_cache && (
        <section className="print-section">
          <h2 className="print-section-title">Vue d'ensemble</h2>
          <p className="print-prose">{synopsis.overview_cache}</p>
        </section>
      )}

      {/* Synopsis */}
      {hookContent && (
        <section className="print-section">
          <h2 className="print-section-title">Synopsis</h2>
          <PrintProse text={hookContent} className="print-prose" />
        </section>
      )}

      {/* NPCs */}
      {npcs.length > 0 && (
        <section className="print-section">
          <h2 className="print-section-title">Personnages non-joueurs</h2>
          <div className="print-npc-grid">
            {npcs.map(npc => {
              const img = firstImage(npc.images)
              return (
                <div key={npc.id} className="print-npc-card">
                  {img && (
                    <img src={img} alt={npc.name} className="print-npc-img" />
                  )}
                  <div className="print-npc-body">
                    <div className="print-npc-name">{npc.name}</div>
                    {npc.role && <div className="print-npc-role">{npc.role}</div>}
                    {npc.description && <PrintProse text={npc.description} className="print-npc-desc" />}
                    {npc.motivation && <p className="print-npc-motivation"><em>Motivation : </em>{npc.motivation}</p>}
                    {npc.quote && <p className="print-npc-quote">« {npc.quote} »</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Scenes */}
      {visibleScenes.length > 0 && (
        <section className="print-section">
          <h2 className="print-section-title">Scènes</h2>
          <div className="print-scenes">
            {visibleScenes.map((scene, idx) => (
              <div key={scene.id} className="print-scene">
                <div className="print-scene-header">
                  <span className="print-scene-num">{idx + 1}</span>
                  <span className="print-scene-title">{scene.title}</span>
                  <span className={`print-badge ${STATUS_CLASS[scene.status] ?? ''}`}>
                    {STATUS_LABEL[scene.status] ?? scene.status}
                  </span>
                  {scene.location_name && (
                    <span className="print-scene-location">📍 {scene.location_name}</span>
                  )}
                </div>
                {scene.description && <PrintProse text={scene.description} className="print-prose mt-1" />}
                {scene.outcome && (
                  <p className="print-outcome"><strong>Dénouement : </strong>{scene.outcome}</p>
                )}
                {scene.notes && (
                  <p className="print-notes"><strong>Notes MJ : </strong>{scene.notes}</p>
                )}
                {scene.npcs.length > 0 && (
                  <div className="print-scene-npcs">
                    <strong>PNJs : </strong>
                    {scene.npcs.map((n, i) => (
                      <span key={n.id}>{n.name}{i < scene.npcs.length - 1 ? ', ' : ''}</span>
                    ))}
                  </div>
                )}
                {scene.artefacts.length > 0 && (
                  <div className="print-scene-artefacts">
                    <strong>Artefacts : </strong>
                    {scene.artefacts.map((a, i) => (
                      <span key={a.id}>{a.name}{i < scene.artefacts.length - 1 ? ', ' : ''}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
