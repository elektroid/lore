import type { SceneStatus } from './synopsis'

// Scenario factory — see docs/scenario-factory.md.
//
// A draft is a proposal, not a scenario. Every item carries `ref`, the short
// handle the model chose so scenes can point at it, and `include`, the GM's
// flag. Commit resolves refs to real row ids; nothing exists in the campaign
// until then.

export interface ProposalFaction {
  ref: string
  name: string
  type: string
  description: string
  motivation: string
  include: boolean
}

export interface ProposalLocation {
  ref: string
  name: string
  city: string
  district: string
  description: string
  atmosphere: string
  include: boolean
}

export interface ProposalNPC {
  ref: string
  name: string
  role: string
  description: string
  quote: string
  motivation: string
  faction_ref: string
  include: boolean
}

export interface ProposalArtefact {
  ref: string
  name: string
  description: string
  include: boolean
}

export interface ProposalScene {
  ref: string
  title: string
  status: SceneStatus
  summary: string
  description: string
  outcome: string
  notes: string
  location_ref: string
  npc_refs: string[]
  artefact_refs: string[]
  is_start: boolean
  is_end: boolean
  expanded: boolean
  include: boolean
}

export interface Proposal {
  title: string
  pitch: string
  factions: ProposalFaction[]
  locations: ProposalLocation[]
  npcs: ProposalNPC[]
  artefacts: ProposalArtefact[]
  scenes: ProposalScene[]
}

export interface ScenarioDraft {
  id: string
  campaign_id: string
  scenario_id: string
  title: string
  brief: string
  status: 'draft' | 'committed'
  proposal: string // JSON string
  created_at: string
  updated_at: string
}

const emptyProposal: Proposal = {
  title: '', pitch: '', factions: [], locations: [], npcs: [], artefacts: [], scenes: [],
}

/** Parse a draft's proposal. A corrupt blob yields an empty one — a page the GM
 *  can still read and delete beats a page that refuses to load. */
export function parseProposal(draft: ScenarioDraft | undefined): Proposal {
  if (!draft) return emptyProposal
  try {
    const p = JSON.parse(draft.proposal) as Partial<Proposal>
    return {
      title: p.title ?? '',
      pitch: p.pitch ?? '',
      factions: p.factions ?? [],
      locations: p.locations ?? [],
      npcs: p.npcs ?? [],
      artefacts: p.artefacts ?? [],
      scenes: p.scenes ?? [],
    }
  } catch {
    return emptyProposal
  }
}

export const SCENE_COUNT_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 12] as const
