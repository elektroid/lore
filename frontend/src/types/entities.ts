export interface NPCImage {
  id: string
  url: string
  label: string
}

export interface CampaignNPC {
  id: string
  campaign_id: string
  name: string
  role: string
  description: string
  quote: string
  motivation: string
  images: string  // JSON array of NPCImage
  sheet: string   // values for the campaign's game's sheet_template, scope:"npc" fields
  created_at: string
  updated_at: string
}

export interface LocationImage {
  id: string
  url: string
  label: string
  type: 'illustration' | 'map'
}

export interface CampaignLocation {
  id: string
  campaign_id: string
  name: string
  city: string
  district: string
  description: string
  atmosphere: string
  images: string  // JSON array of LocationImage
  created_at: string
  updated_at: string
}

export interface ArtefactImage {
  id: string
  url: string
  label: string
}

export interface CampaignArtefact {
  id: string
  campaign_id: string
  name: string
  description: string
  images: string  // JSON array of ArtefactImage
  created_at: string
  updated_at: string
}

export interface NPCArtefactLink {
  id: string
  npc_id: string
  artefact_id: string
  nature: string
  created_at: string
  npc_name: string
  artefact_name: string
}

export interface FactionImage {
  id: string
  url: string
  label: string
}

export interface CampaignFaction {
  id: string
  campaign_id: string
  name: string
  type: string
  description: string
  motivation: string
  images: string  // JSON array of FactionImage
  created_at: string
  updated_at: string
}

export interface PendingImage {
  id: string
  url: string
}

export interface SearchResult {
  type: 'npc' | 'location' | 'artefact' | 'faction' | 'scene'
  id: string
  name: string
  subtitle: string
  snippet: string
  scenario_id?: string
}
