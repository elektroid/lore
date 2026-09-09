import type { ReactNode } from 'react'
import PrintProse from './PrintProse'
import { type MentionNames } from './helpers'
import type { Scene } from '@/types/synopsis'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-section">
      <h2 className="doc-h2">{title}</h2>
      {children}
    </section>
  )
}

export function Figure({ src, alt, wide }: { src: string | null; alt: string; wide?: boolean }) {
  const cls = `doc-entry__figure${wide ? ' doc-entry__figure--wide' : ''}`
  if (!src) {
    // The placeholder keeps every entry's text starting on the same vertical
    // line, so a cast list with only three portraits still reads as a list.
    return <div className={cls}><div className="doc-entry__figure--empty">{initials(alt)}</div></div>
  }
  return (
    <div className={cls}>
      {/* crossOrigin is deliberately unset: uploads are same-origin. */}
      <img src={src} alt={alt} />
    </div>
  )
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

/** One entry in an appendix: portrait on the left, everything else on the right. */
export function Entry({
  name, role, image, wideImage, appearsIn, children,
}: {
  name: string
  role?: string
  image: string | null
  wideImage?: boolean
  /** Chapter.scene references, e.g. ["1.02", "2.01"] — see buildAppearances. */
  appearsIn?: string[]
  children?: ReactNode
}) {
  return (
    <article className="doc-entry">
      <Figure src={image} alt={name} wide={wideImage} />
      <div className="doc-entry__body">
        <div className="doc-entry__name">{name || <span className="doc-empty">(sans nom)</span>}</div>
        {role && <div className="doc-entry__role">{role}</div>}
        {children}
        {appearsIn && appearsIn.length > 0 && (
          <div className="doc-entry__refs">Apparaît en {appearsIn.join(', ')}</div>
        )}
      </div>
    </article>
  )
}

export function Field({ label, text, names }: { label: string; text: string; names?: MentionNames }) {
  if (!text.trim()) return null
  return (
    <div className="doc-entry__field">
      <b>{label}</b>
      <PrintProse text={text} names={names} />
    </div>
  )
}

const SCENE_STATUS: Record<string, { label: string; cls: string }> = {
  idea: { label: 'Idée', cls: 'doc-badge--idea' },
  optional_step: { label: 'Optionnelle', cls: 'doc-badge--optional' },
  key_event: { label: 'Événement clé', cls: 'doc-badge--key' },
}

/**
 * The scenes of one scenario, in order.
 *
 * Dividers are rendered as act breaks rather than filtered out: the author put
 * them in the scene list to give the scenario a shape, and dropping them from
 * the printed version throws that shape away. Numbering is a CSS counter, so
 * it counts scenes and skips the breaks without any index arithmetic here.
 */
export function Scenes({ scenes, names }: { scenes: Scene[]; names?: MentionNames }) {
  if (scenes.length === 0) {
    return <p className="doc-empty">Aucune scène n'a encore été écrite.</p>
  }
  return (
    <div className="doc-scenes">
      {scenes.map(scene => scene.type === 'divider' ? (
        <div key={scene.id} className="doc-act">{scene.title || 'Acte suivant'}</div>
      ) : (
        <article key={scene.id} className="doc-scene">
          <header className="doc-scene__head">
            <span className="doc-scene__num" />
            <h3 className="doc-scene__title">
              {scene.title || <span className="doc-empty">Scène sans titre</span>}
            </h3>
            {scene.is_start && <span className="doc-badge doc-badge--start">Début</span>}
            {scene.is_end && <span className="doc-badge doc-badge--end">Fin</span>}
            <span className={`doc-badge ${SCENE_STATUS[scene.status]?.cls ?? ''}`}>
              {SCENE_STATUS[scene.status]?.label ?? scene.status}
            </span>
          </header>

          {scene.location_name && (
            <div className="doc-scene__where">{scene.location_name}</div>
          )}

          <PrintProse text={scene.description} names={names} />

          {scene.outcome.trim() && (
            <div className="doc-note">
              <span className="doc-note__label">Dénouement</span>
              <PrintProse text={scene.outcome} names={names} />
            </div>
          )}
          {scene.notes.trim() && (
            <div className="doc-note">
              <span className="doc-note__label">Notes du meneur</span>
              <PrintProse text={scene.notes} names={names} />
            </div>
          )}

          {(scene.npcs.length > 0 || scene.artefacts.length > 0) && (
            <div className="doc-scene__tags">
              {scene.npcs.length > 0 && (
                <div><b>En scène : </b>{scene.npcs.map(n => n.name).join(' · ')}</div>
              )}
              {scene.artefacts.length > 0 && (
                <div><b>Objets : </b>{scene.artefacts.map(a => a.name).join(' · ')}</div>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
