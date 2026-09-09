import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import PrintProse from '@/print/PrintProse'
import { buildMentionNames, firstImage, waitForPaint } from '@/print/helpers'
import { Entry, Field, Scenes, Section } from '@/print/blocks'
import type { CampaignPrintDoc } from '@/print/types'
import '@/print/print.css'

/**
 * One scenario, printed — what a meneur takes to the table tonight.
 *
 * It reads the campaign document and narrows it to a single scenario, rather
 * than keeping a second set of queries and a second layout in step with the
 * first. That is also how it gained pictures: the cast pages here are the
 * campaign's entities, filtered to the ones this scenario actually uses.
 *
 * See docs/print.md.
 */
export default function PrintPage() {
  const { id } = useParams<{ id: string }>()
  const scenarioId = id!
  const [params] = useSearchParams()
  const autoPrint = params.get('auto') !== '0'

  const rootRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  // The scenario knows its campaign; the campaign document has everything else.
  const { data: scenario } = useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => api.get<{ campaign_id: string }>(`/scenarios/${scenarioId}`),
  })

  const { data, isError, error } = useQuery({
    queryKey: ['campaign-print', scenario?.campaign_id],
    queryFn: () => api.get<CampaignPrintDoc>(`/campaigns/${scenario!.campaign_id}/print`),
    enabled: !!scenario?.campaign_id,
  })

  const chapter = data?.scenarios.find(s => s.scenario.id === scenarioId)

  useDocTitle(chapter ? `lore : ${chapter.scenario.name}` : 'lore')

  useEffect(() => {
    if (!chapter || !rootRef.current) return
    let cancelled = false
    waitForPaint(rootRef.current).then(() => {
      if (cancelled) return
      setReady(true)
      if (autoPrint) window.print()
    })
    return () => { cancelled = true }
  }, [chapter, autoPrint])

  if (isError) {
    return <Centered>{(error as Error)?.message ?? 'Scénario introuvable.'}</Centered>
  }
  if (!data || !chapter) {
    return <Centered>Préparation du document…</Centered>
  }

  const { campaign } = data
  const names = buildMentionNames(data)
  const hook = parseHook(chapter.synopsis?.hook)

  // Only the entities this scenario uses — a one-evening sheet with the whole
  // campaign's gazetteer stapled to it is a worse document, not a fuller one.
  const usedNpcIds = new Set([
    ...chapter.synopsis_npcs.map(n => n.id),
    ...chapter.scenes.flatMap(s => s.npcs.map(n => n.id)),
  ])
  const usedArtefactIds = new Set(chapter.scenes.flatMap(s => s.artefacts.map(a => a.id)))
  const usedLocationIds = new Set(chapter.scenes.map(s => s.location_id).filter(Boolean))
  const usedFactionIds = new Set(chapter.synopsis_factions.map(f => f.id))

  const npcs = data.npcs.filter(n => usedNpcIds.has(n.id))
  const artefacts = data.artefacts.filter(a => usedArtefactIds.has(a.id))
  const locations = data.locations.filter(l => usedLocationIds.has(l.id))
  const factions = data.factions.filter(f => usedFactionIds.has(f.id))

  const sceneCount = chapter.scenes.filter(s => s.type === 'scene').length

  return (
    <>
      <div className="lore-doc__toolbar">
        <button onClick={() => window.print()}>Imprimer</button>
        <span>{ready ? 'Document prêt' : 'Chargement des images…'}</span>
      </div>

      <div className="lore-doc" ref={rootRef} lang="fr">
        <div className="doc-eyebrow">{campaign.name}</div>
        <h1 className="doc-h1">{chapter.scenario.name || 'Scénario sans titre'}</h1>
        <div className="doc-cover__meta" style={{ border: 0, paddingTop: '2mm' }}>
          <span><b>{sceneCount}</b> scène{sceneCount > 1 ? 's' : ''}</span>
          {npcs.length > 0 && <span><b>{npcs.length}</b> PNJ</span>}
          {campaign.game_name && <span>{campaign.game_name}</span>}
          <span style={{ marginLeft: 'auto' }}>
            {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <hr className="doc-h1-rule" />

        {hook && (
          <Section title="Synopsis">
            <PrintProse text={hook} names={names} />
          </Section>
        )}

        {chapter.synopsis?.overview_cache && (
          <Section title="Vue d'ensemble">
            <p className="doc-prose">{chapter.synopsis.overview_cache}</p>
          </Section>
        )}

        <Section title="Déroulé">
          <Scenes scenes={chapter.scenes} names={names} />
        </Section>

        {npcs.length > 0 && (
          <Section title="Distribution">
            <div className="doc-entries">
              {npcs.map(n => (
                <Entry key={n.id} name={n.name} role={n.role} image={firstImage(n.images)}>
                  <PrintProse text={n.description} names={names} className="doc-entry__desc" />
                  <Field label="Motivation" text={n.motivation} names={names} />
                  {n.quote.trim() && <p className="doc-entry__quote">« {n.quote} »</p>}
                </Entry>
              ))}
            </div>
          </Section>
        )}

        {locations.length > 0 && (
          <Section title="Lieux">
            <div className="doc-entries">
              {locations.map(l => (
                <Entry
                  key={l.id}
                  name={l.name}
                  role={[l.district, l.city].filter(Boolean).join(', ')}
                  image={firstImage(l.images)}
                  wideImage
                >
                  {l.atmosphere && <Field label="Ambiance" text={l.atmosphere} names={names} />}
                  <PrintProse text={l.description} names={names} className="doc-entry__desc" />
                </Entry>
              ))}
            </div>
          </Section>
        )}

        {factions.length > 0 && (
          <Section title="Factions">
            <div className="doc-entries doc-entries--two-up">
              {factions.map(f => (
                <Entry key={f.id} name={f.name} role={f.type} image={firstImage(f.images)} wideImage>
                  <PrintProse text={f.description} names={names} className="doc-entry__desc" />
                  <Field label="Motivation" text={f.motivation} names={names} />
                </Entry>
              ))}
            </div>
          </Section>
        )}

        {artefacts.length > 0 && (
          <Section title="Artefacts">
            <div className="doc-entries doc-entries--two-up">
              {artefacts.map(a => (
                <Entry key={a.id} name={a.name} image={firstImage(a.images)} wideImage>
                  <PrintProse text={a.description} names={names} className="doc-entry__desc" />
                </Entry>
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  )
}

function parseHook(hook: string | undefined): string {
  if (!hook) return ''
  try {
    const v = JSON.parse(hook)
    const obj = typeof v === 'string' ? JSON.parse(v) : v
    return typeof obj?.content === 'string' ? obj.content : ''
  } catch { return '' }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-screen text-sm text-gray-500">
      {children}
    </div>
  )
}
