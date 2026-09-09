import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import PrintProse from '@/print/PrintProse'
import {
  buildAppearances, buildMentionNames, firstImage, flattenProse, waitForPaint,
  type MentionNames,
} from '@/print/helpers'
import { Entry, Field, Scenes, Section } from '@/print/blocks'
import type { CampaignPrintDoc } from '@/print/types'
import '@/print/print.css'

/**
 * The whole campaign as one book.
 *
 * The scenario sheet answers "what am I running tonight". This answers "what is
 * this campaign" — the pitch, every scenario in running order, and the complete
 * cast, gazetteer, factions and props with their pictures, which is what the
 * scenario sheet could never show because it only ever knew about one scenario.
 *
 * Everything arrives in one request (GET /campaigns/:id/print) so the page is
 * either complete or still loading, never half-painted when the print dialog
 * opens. See docs/print.md.
 */
export default function CampaignPrintPage() {
  const { id } = useParams<{ id: string }>()
  const campaignId = id!
  const [params] = useSearchParams()
  // `?auto=0` for anyone who wants to look at the document before printing it —
  // and for the screenshot tests, which must not be interrupted by a dialog.
  const autoPrint = params.get('auto') !== '0'

  const rootRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['campaign-print', campaignId],
    queryFn: () => api.get<CampaignPrintDoc>(`/campaigns/${campaignId}/print`),
  })

  useDocTitle(data ? `lore : ${data.campaign.name}` : 'lore')

  useEffect(() => {
    if (!data || !rootRef.current) return
    let cancelled = false
    waitForPaint(rootRef.current).then(() => {
      if (cancelled) return
      setReady(true)
      if (autoPrint) window.print()
    })
    return () => { cancelled = true }
  }, [data, autoPrint])

  if (isLoading) {
    return <Centered>Préparation du document…</Centered>
  }
  if (isError || !data) {
    return <Centered>{(error as Error)?.message ?? 'Campagne introuvable.'}</Centered>
  }

  const { campaign, scenarios, npcs, locations, factions, artefacts } = data
  const names = buildMentionNames(data)
  const appearsIn = buildAppearances(scenarios)

  const sceneCount = scenarios.reduce(
    (n, s) => n + s.scenes.filter(x => x.type === 'scene').length, 0)
  const portraits = npcs.map(n => firstImage(n.images)).filter(Boolean).slice(0, 5) as string[]

  const appendices = [
    { key: 'cast', label: 'Distribution', count: npcs.length, unit: 'PNJ' },
    { key: 'places', label: 'Lieux', count: locations.length, unit: locations.length > 1 ? 'lieux' : 'lieu' },
    { key: 'factions', label: 'Factions', count: factions.length, unit: factions.length > 1 ? 'factions' : 'faction' },
    { key: 'props', label: 'Artefacts', count: artefacts.length, unit: artefacts.length > 1 ? 'artefacts' : 'artefact' },
  ].filter(a => a.count > 0)

  return (
    <>
      <div className="lore-doc__toolbar">
        <button onClick={() => window.print()}>Imprimer</button>
        <span>{ready ? 'Document prêt' : 'Chargement des images…'}</span>
      </div>

      <div className="lore-doc" ref={rootRef} lang="fr">
        {/* ── Cover ─────────────────────────────────────────────────────── */}
        <div className="doc-cover">
          {campaign.game_name && <div className="doc-cover__eyebrow">{campaign.game_name}</div>}
          <h1 className="doc-cover__title">{campaign.name}</h1>
          {campaign.genre && <div className="doc-cover__genre">{campaign.genre}</div>}

          <hr className="doc-cover__rule" />

          {campaign.pitch
            ? <PrintProse text={campaign.pitch} names={names} className="doc-cover__pitch" />
            : <p className="doc-empty">Cette campagne n'a pas encore de pitch.</p>}

          {portraits.length > 0 && (
            <div className="doc-cover__cast">
              {portraits.map((src, i) => <img key={i} src={src} alt="" />)}
            </div>
          )}

          {/* One block of content at the top, one band of facts at the foot,
              and the air between them — rather than a hole punched through the
              middle of the composition. */}
          <div className="doc-cover__spacer" />

          <div className="doc-cover__meta">
            <span><b>{scenarios.length}</b> scénario{scenarios.length > 1 ? 's' : ''}</span>
            <span><b>{sceneCount}</b> scène{sceneCount > 1 ? 's' : ''}</span>
            {npcs.length > 0 && <span><b>{npcs.length}</b> PNJ</span>}
            {locations.length > 0 && <span><b>{locations.length}</b> lieu{locations.length > 1 ? 'x' : ''}</span>}
            {factions.length > 0 && <span><b>{factions.length}</b> faction{factions.length > 1 ? 's' : ''}</span>}
            {artefactsLabel(artefacts.length)}
            <span style={{ marginLeft: 'auto' }}>
              {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* ── Sommaire ──────────────────────────────────────────────────── */}
        <div className="doc-break">
          <div className="doc-eyebrow">Campagne</div>
          <h1 className="doc-h1">Sommaire</h1>
          <hr className="doc-h1-rule" />

          <div className="doc-toc">
            {scenarios.map((s, i) => {
              const n = s.scenes.filter(x => x.type === 'scene').length
              const blurb = summarise(parseHook(s.synopsis?.hook), names)
              return (
                <div key={s.scenario.id}>
                  <div className="doc-toc__item">
                    <span className="doc-toc__num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="doc-toc__label">{s.scenario.name || 'Scénario sans titre'}</span>
                    <span className="doc-toc__count">{n} scène{n > 1 ? 's' : ''}</span>
                  </div>
                  {blurb && <p className="doc-toc__blurb">{blurb}</p>}
                </div>
              )
            })}
            {scenarios.length === 0 && (
              <p className="doc-empty">Aucun scénario dans cette campagne.</p>
            )}

            {appendices.map(a => (
              <div key={a.key} className="doc-toc__item">
                <span className="doc-toc__num">—</span>
                <span className="doc-toc__label">{a.label}</span>
                <span className="doc-toc__count">{a.count} {a.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── One page-opening section per scenario ─────────────────────── */}
        {scenarios.map((s, i) => {
          const hook = parseHook(s.synopsis?.hook)
          return (
            <div key={s.scenario.id} className="doc-break">
              <div className="doc-eyebrow">Scénario {String(i + 1).padStart(2, '0')}</div>
              <h1 className="doc-h1">{s.scenario.name || 'Scénario sans titre'}</h1>
              <hr className="doc-h1-rule" />

              {hook && (
                <Section title="Synopsis">
                  <PrintProse text={hook} names={names} />
                </Section>
              )}

              {s.synopsis?.overview_cache && (
                <Section title="Vue d'ensemble">
                  <p className="doc-prose">{s.synopsis.overview_cache}</p>
                </Section>
              )}

              {(s.synopsis_npcs.length > 0 || s.synopsis_factions.length > 0) && (
                <Section title="Qui apparaît">
                  {s.synopsis_npcs.length > 0 && (
                    <p className="doc-prose">
                      <b>PNJ — </b>
                      {s.synopsis_npcs.map(n => n.role ? `${n.name} (${n.role})` : n.name).join(' · ')}
                    </p>
                  )}
                  {s.synopsis_factions.length > 0 && (
                    <p className="doc-prose">
                      <b>Factions — </b>
                      {s.synopsis_factions.map(f => f.name).join(' · ')}
                    </p>
                  )}
                </Section>
              )}

              <Section title="Déroulé">
                <Scenes scenes={s.scenes} names={names} />
              </Section>
            </div>
          )
        })}

        {/* ── Appendices ────────────────────────────────────────────────── */}
        {npcs.length > 0 && (
          <div className="doc-break">
            <div className="doc-eyebrow">Annexe</div>
            <h1 className="doc-h1">Distribution</h1>
            <p className="doc-lede">Tous les personnages de la campagne.</p>
            <hr className="doc-h1-rule" />
            <div className="doc-entries">
              {npcs.map(n => (
                <Entry key={n.id} name={n.name} role={n.role} image={firstImage(n.images)}
                  appearsIn={appearsIn.get(n.id)}>
                  <PrintProse text={n.description} names={names} className="doc-entry__desc" />
                  <Field label="Motivation" text={n.motivation} names={names} />
                  {n.quote.trim() && <p className="doc-entry__quote">« {n.quote} »</p>}
                </Entry>
              ))}
            </div>
          </div>
        )}

        {locations.length > 0 && (
          <div className="doc-break">
            <div className="doc-eyebrow">Annexe</div>
            <h1 className="doc-h1">Lieux</h1>
            <p className="doc-lede">Où la campagne se joue.</p>
            <hr className="doc-h1-rule" />
            <div className="doc-entries">
              {locations.map(l => (
                <Entry
                  key={l.id}
                  name={l.name}
                  role={[l.district, l.city].filter(Boolean).join(', ')}
                  image={firstImage(l.images)}
                  wideImage
                  appearsIn={appearsIn.get(l.id)}
                >
                  {l.atmosphere && <Field label="Ambiance" text={l.atmosphere} names={names} />}
                  <PrintProse text={l.description} names={names} className="doc-entry__desc" />
                </Entry>
              ))}
            </div>
          </div>
        )}

        {factions.length > 0 && (
          <div className="doc-break">
            <div className="doc-eyebrow">Annexe</div>
            <h1 className="doc-h1">Factions</h1>
            <p className="doc-lede">Les forces en présence.</p>
            <hr className="doc-h1-rule" />
            <div className="doc-entries doc-entries--two-up">
              {factions.map(f => (
                <Entry key={f.id} name={f.name} role={f.type} image={firstImage(f.images)} wideImage
                  appearsIn={appearsIn.get(f.id)}>
                  <PrintProse text={f.description} names={names} className="doc-entry__desc" />
                  <Field label="Motivation" text={f.motivation} names={names} />
                </Entry>
              ))}
            </div>
          </div>
        )}

        {artefacts.length > 0 && (
          <div className="doc-break">
            <div className="doc-eyebrow">Annexe</div>
            <h1 className="doc-h1">Artefacts</h1>
            <p className="doc-lede">Les objets qui comptent.</p>
            <hr className="doc-h1-rule" />
            <div className="doc-entries doc-entries--two-up">
              {artefacts.map(a => (
                <Entry key={a.id} name={a.name} image={firstImage(a.images)} wideImage
                  appearsIn={appearsIn.get(a.id)}>
                  <PrintProse text={a.description} names={names} className="doc-entry__desc" />
                </Entry>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function artefactsLabel(n: number) {
  if (n === 0) return null
  return <span key="art"><b>{n}</b> artefact{n > 1 ? 's' : ''}</span>
}

/** The first sentence or so of a synopsis, for the contents page. */
function summarise(text: string, names: MentionNames, max = 150): string {
  const flat = flattenProse(text, names)
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' — '), cut.lastIndexOf(', '))
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd()) + '…'
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
