import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Image as ImageIcon, Loader2, MonitorOff, MonitorPlay, PenLine, Search, Type } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  CampaignArtefact, CampaignFaction, CampaignLocation, CampaignNPC,
} from '@/types/entities'
import type { Scene } from '@/types/synopsis'
import type { Projection } from '@/types/table'

// The Excalidraw bundle (~1.5MB) is only fetched when the GM opens this tab.
const WhiteboardEditor = lazy(() =>
  import('@/components/play/Whiteboard').then(m => ({ default: m.WhiteboardEditor })))

/** One projectable image, already resolved to a URL and a caption. */
interface Shot {
  key: string
  url: string
  title: string
  subtitle: string
}

interface EntityImage { id?: string; url?: string; label?: string }

function shotsOf(rawImages: string, title: string, subtitle: string, ns: string): Shot[] {
  let images: EntityImage[]
  try { images = JSON.parse(rawImages || '[]') || [] } catch { images = [] }

  return images
    .filter((img): img is EntityImage & { url: string } => Boolean(img?.url))
    .map((img, i) => ({
      key: `${ns}:${img.id ?? i}`,
      url: img.url,
      title,
      // An image label ("carte", "de nuit") is more useful than the generic subtitle
      subtitle: img.label || subtitle,
    }))
}

type Tab = 'scene' | 'campaign' | 'text' | 'draw'

/**
 * The GM's side of the table screen: pick an image, it appears in the room.
 *
 * The tray only ever hands out a URL and a caption — the table surface never
 * learns which entity it came from, and never gains entity read access.
 */
export default function ProjectionPanel({
  campaignId, scene, current, onProject, onClear, pending,
}: {
  campaignId: string
  scene: Scene | null
  current: Projection
  onProject: (p: Projection) => void
  onClear: () => void
  pending?: boolean
}) {
  const [tab, setTab] = useState<Tab>('scene')
  const [search, setSearch] = useState('')
  const [cardTitle, setCardTitle] = useState('')
  const [cardSubtitle, setCardSubtitle] = useState('')
  // Once opened, the whiteboard stays mounted (just hidden) across tab
  // switches — an in-progress, not-yet-projected sketch is component state,
  // and unmounting it the way the other tabs' one-field forms tolerate would
  // silently throw away a drawing.
  const [drawOpened, setDrawOpened] = useState(false)

  // The scene's own location, needed for its images — scenes only carry a name.
  const { data: sceneLocation } = useQuery({
    queryKey: ['location', scene?.location_id],
    queryFn: () => api.get<CampaignLocation>(`/campaigns/${campaignId}/locations/${scene!.location_id}`),
    enabled: !!scene?.location_id && !!campaignId,
  })

  const libraryEnabled = tab === 'campaign' && !!campaignId
  const { data: locations = [] } = useQuery({
    queryKey: ['campaign-locations', campaignId],
    queryFn: () => api.get<CampaignLocation[]>(`/campaigns/${campaignId}/locations`),
    enabled: libraryEnabled,
  })
  const { data: npcs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
    enabled: libraryEnabled,
  })
  const { data: artefacts = [] } = useQuery({
    queryKey: ['campaign-artefacts', campaignId],
    queryFn: () => api.get<CampaignArtefact[]>(`/campaigns/${campaignId}/artefacts`),
    enabled: libraryEnabled,
  })
  const { data: factions = [] } = useQuery({
    queryKey: ['campaign-factions', campaignId],
    queryFn: () => api.get<CampaignFaction[]>(`/campaigns/${campaignId}/factions`),
    enabled: libraryEnabled,
  })

  const sceneShots = useMemo<Shot[]>(() => {
    if (!scene) return []
    return [
      ...(sceneLocation ? shotsOf(sceneLocation.images, sceneLocation.name, 'Lieu', 'loc') : []),
      ...scene.npcs.flatMap(n => shotsOf(n.images, n.name, n.role || 'PNJ', `npc-${n.id}`)),
      ...scene.artefacts.flatMap(a => shotsOf(a.images, a.name, 'Artefact', `art-${a.id}`)),
    ]
  }, [scene, sceneLocation])

  const libraryShots = useMemo<Shot[]>(() => [
    ...locations.flatMap(l => shotsOf(l.images, l.name, [l.district, l.city].filter(Boolean).join(', ') || 'Lieu', `loc-${l.id}`)),
    ...npcs.flatMap(n => shotsOf(n.images, n.name, n.role || 'PNJ', `npc-${n.id}`)),
    ...artefacts.flatMap(a => shotsOf(a.images, a.name, 'Artefact', `art-${a.id}`)),
    ...factions.flatMap(f => shotsOf(f.images, f.name, f.type || 'Faction', `fac-${f.id}`)),
  ], [locations, npcs, artefacts, factions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return libraryShots
    return libraryShots.filter(s =>
      s.title.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q))
  }, [libraryShots, search])

  const live = current.kind !== ''

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">

      {/* ── What is on screen right now ─────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MonitorPlay className="h-4 w-4 text-muted-foreground" />
          Projection
        </h3>
        <div className="ml-auto">
          <Button
            size="sm" variant="outline" className="h-7 px-2 text-xs"
            disabled={!live || pending}
            onClick={onClear}
          >
            <MonitorOff className="h-3.5 w-3.5 mr-1" />
            Éteindre
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
        {current.kind === 'image' && current.url ? (
          <img src={current.url} alt="" className="h-12 w-16 rounded object-cover shrink-0" />
        ) : (
          <div className="h-12 w-16 rounded bg-muted flex items-center justify-center shrink-0">
            {current.kind === 'text' && <Type className="h-4 w-4 text-muted-foreground" />}
            {current.kind === 'draw' && <PenLine className="h-4 w-4 text-muted-foreground" />}
            {current.kind !== 'text' && current.kind !== 'draw' && <MonitorOff className="h-4 w-4 text-muted-foreground/50" />}
          </div>
        )}
        <div className="min-w-0">
          {live ? (
            current.kind === 'draw' ? (
              <p className="text-sm font-medium">Tableau</p>
            ) : (
              <>
                <p className="text-sm font-medium truncate">{current.title || 'Sans titre'}</p>
                <p className="text-xs text-muted-foreground truncate">{current.subtitle || '—'}</p>
              </>
            )
          ) : (
            <p className="text-sm text-muted-foreground italic">Écran éteint</p>
          )}
        </div>
      </div>

      {/* ── Source tabs ──────────────────────────────────────────────────── */}
      <div className="flex gap-1">
        {([
          ['scene', 'Scène', ImageIcon],
          ['campaign', 'Campagne', Search],
          ['text', 'Carton texte', Type],
          ['draw', 'Tableau', PenLine],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => { setTab(id); if (id === 'draw') setDrawOpened(true) }}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
              tab === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'scene' && (
        <ShotGrid
          shots={sceneShots}
          currentUrl={current.url}
          onPick={onProject}
          empty={scene
            ? "Aucune image sur cette scène. Passez à l'onglet Campagne."
            : 'Sélectionnez une scène pour voir ses images.'}
        />
      )}

      {tab === 'campaign' && (
        <div className="space-y-2">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filtrer par nom…"
            className="h-8 text-xs"
          />
          <ShotGrid
            shots={filtered}
            currentUrl={current.url}
            onPick={onProject}
            empty="Aucune image ne correspond."
          />
        </div>
      )}

      {tab === 'text' && (
        <div className="space-y-2">
          <Input
            value={cardTitle}
            onChange={e => setCardTitle(e.target.value)}
            placeholder="Six mois plus tard"
            className="h-8 text-xs"
          />
          <Input
            value={cardSubtitle}
            onChange={e => setCardSubtitle(e.target.value)}
            placeholder="Sous-titre (optionnel)"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="h-8 w-full text-xs"
            disabled={!cardTitle.trim() || pending}
            onClick={() => onProject({
              kind: 'text',
              url: '',
              title: cardTitle.trim(),
              subtitle: cardSubtitle.trim(),
            })}
          >
            Projeter le carton
          </Button>
        </div>
      )}

      {drawOpened && (
        <div className={tab === 'draw' ? '' : 'hidden'}>
          <Suspense fallback={
            <div className="h-[440px] flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }>
            <WhiteboardEditor
              scene={current.kind === 'draw' ? (current.scene ?? '') : ''}
              live={current.kind === 'draw'}
              pending={pending}
              onProject={sceneJson => onProject({ kind: 'draw', url: '', title: '', subtitle: '', scene: sceneJson })}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}

function ShotGrid({
  shots, currentUrl, onPick, empty,
}: {
  shots: Shot[]
  currentUrl: string
  onPick: (p: Projection) => void
  empty: string
}) {
  if (shots.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2">{empty}</p>
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
      {shots.map(shot => (
        <button
          key={shot.key}
          onClick={() => onPick({ kind: 'image', url: shot.url, title: shot.title, subtitle: shot.subtitle })}
          title={`${shot.title} — ${shot.subtitle}`}
          className={`group relative aspect-video overflow-hidden rounded-md border transition-all ${
            shot.url === currentUrl
              ? 'border-primary ring-1 ring-primary'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <img src={shot.url} alt={shot.title} className="h-full w-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] leading-tight text-white truncate">
            {shot.title}
          </span>
        </button>
      ))}
    </div>
  )
}
