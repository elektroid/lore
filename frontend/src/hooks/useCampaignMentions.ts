import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { MENTION_KINDS, type MentionKind } from '@/lib/mentions'
import type {
  CampaignNPC, CampaignArtefact, CampaignLocation, CampaignFaction,
} from '@/types/entities'

/** One entity offered in the suggestion dropdown. */
export interface Mentionable {
  kind: MentionKind
  id: string
  name: string
  /** Secondary line — role, atmosphere, type. Empty when the entity has none. */
  sub: string
}

export interface CampaignMentions {
  /** Every mentionable entity in the campaign, in MENTION_KINDS order. */
  all: Mentionable[]
  /** The live name of an entity, or undefined when it no longer exists. */
  resolve: (kind: MentionKind, id: string) => string | undefined
  /** Ranked suggestions for what the GM has typed after the `@`. */
  search: (query: string, limit?: number) => Mentionable[]
}

/**
 * The four entity lists a mention can point at, as one lookup.
 *
 * Shared by the editor and the read-only renderer so a chip means the same
 * thing wherever it is drawn. The queries reuse the keys the entity pages
 * already populate, so opening an editor over a list the GM was just looking at
 * costs no request.
 */
export function useCampaignMentions(campaignId: string): CampaignMentions {
  const enabled = !!campaignId
  const staleTime = 60_000

  const npcs = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
    enabled, staleTime,
  })
  const artefacts = useQuery({
    queryKey: ['campaign-artefacts', campaignId],
    queryFn: () => api.get<CampaignArtefact[]>(`/campaigns/${campaignId}/artefacts`),
    enabled, staleTime,
  })
  const locations = useQuery({
    queryKey: ['campaign-locations', campaignId],
    queryFn: () => api.get<CampaignLocation[]>(`/campaigns/${campaignId}/locations`),
    enabled, staleTime,
  })
  const factions = useQuery({
    queryKey: ['campaign-factions', campaignId],
    queryFn: () => api.get<CampaignFaction[]>(`/campaigns/${campaignId}/factions`),
    enabled, staleTime,
  })

  const all = useMemo<Mentionable[]>(() => [
    ...(npcs.data ?? []).map(n => ({ kind: 'npc' as const, id: n.id, name: n.name, sub: n.role })),
    ...(artefacts.data ?? []).map(a => ({ kind: 'artefact' as const, id: a.id, name: a.name, sub: '' })),
    ...(locations.data ?? []).map(l => ({ kind: 'location' as const, id: l.id, name: l.name, sub: l.city })),
    ...(factions.data ?? []).map(f => ({ kind: 'faction' as const, id: f.id, name: f.name, sub: f.type })),
  ], [npcs.data, artefacts.data, locations.data, factions.data])

  const byRef = useMemo(() => {
    const m = new Map<string, string>()
    for (const item of all) m.set(`${item.kind}:${item.id}`, item.name)
    return m
  }, [all])

  return useMemo(() => ({
    all,
    resolve: (kind, id) => byRef.get(`${kind}:${id}`),
    // Unnamed entities are skipped: there is nothing to type to reach them, and
    // a chip reading "@" tells the GM nothing.
    search: (query, limit = 8) => {
      const q = query.toLowerCase()
      return all
        .filter(i => i.name && i.name.toLowerCase().includes(q))
        .sort((a, b) => rank(a, q) - rank(b, q))
        .slice(0, limit)
    },
  }), [all, byRef])
}

// Prefix matches first — typing "ba" should reach Bartmoss before it reaches
// "Rache Bartmoss's debt". Kind order breaks the remaining ties so the list
// does not reshuffle as the GM types.
function rank(item: Mentionable, q: string): number {
  const prefix = item.name.toLowerCase().startsWith(q) ? 0 : 100
  return prefix + MENTION_KINDS.indexOf(item.kind)
}
