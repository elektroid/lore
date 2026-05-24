import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, User, MapPin, Package, Shield, Film } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/api/client'
import type { SearchResult } from '@/types/entities'

const TYPE_LABELS: Record<string, string> = {
  npc: 'PNJ',
  location: 'Lieu',
  artefact: 'Artefact',
  faction: 'Faction',
  scene: 'Scène',
}

const TYPE_TAB: Record<string, string> = {
  npc: 'npcs',
  location: 'locations',
  artefact: 'artefacts',
  faction: 'factions',
}

function TypeIcon({ type }: { type: string }) {
  const cls = 'h-3.5 w-3.5 shrink-0'
  switch (type) {
    case 'npc':      return <User className={cls} />
    case 'location': return <MapPin className={cls} />
    case 'artefact': return <Package className={cls} />
    case 'faction':  return <Shield className={cls} />
    case 'scene':    return <Film className={cls} />
    default:         return null
  }
}

interface Props {
  open: boolean
  onClose: () => void
  campaignId: string
  onSelect: (tab: string, entityId: string) => void
}

export default function SearchDialog({ open, onClose, campaignId, onSelect }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // debounce
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.get<SearchResult[]>(`/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}`)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, campaignId])

  // reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  function handleSelect(r: SearchResult) {
    onClose()
    if (r.type === 'scene' && r.scenario_id) {
      navigate(`/scenarios/${r.scenario_id}/synopsis`)
      return
    }
    const tab = TYPE_TAB[r.type]
    if (tab) onSelect(tab, r.id)
  }

  // group results by type
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.type] ??= []).push(r)
    return acc
  }, {})
  const order = ['npc', 'location', 'artefact', 'faction', 'scene']

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher dans la campagne…"
            className="border-0 shadow-none focus-visible:ring-0 h-8 px-0 text-sm"
          />
        </div>

        {query.trim() && (
          <div className="max-h-[60vh] overflow-y-auto py-2">
            {loading && (
              <p className="px-4 py-3 text-xs text-muted-foreground">Recherche…</p>
            )}
            {!loading && results.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">Aucun résultat.</p>
            )}
            {!loading && order.map(type => {
              const group = grouped[type]
              if (!group?.length) return null
              return (
                <div key={type}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {TYPE_LABELS[type]}
                  </p>
                  {group.map(r => (
                    <button
                      key={r.id}
                      onClick={() => handleSelect(r)}
                      className="w-full flex items-start gap-3 px-4 py-2 text-left hover:bg-muted transition-colors"
                    >
                      <span className="mt-0.5 text-muted-foreground"><TypeIcon type={r.type} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.name || <span className="italic text-muted-foreground">(sans nom)</span>}</p>
                        {r.subtitle && <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>}
                        {r.snippet && <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5">{r.snippet}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {!query.trim() && (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            Tapez pour rechercher parmi les PNJs, lieux, artefacts, factions et scènes.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
