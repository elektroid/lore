export type ItemStatus = 'draft' | 'in_progress' | 'confirmed'

export interface HookData {
  content: string
  status: ItemStatus
}

export interface SynopsisNPC {
  id: string           // campaign_npcs.id
  scenario_id: string
  campaign_id: string
  name: string
  role: string
  description: string
  quote: string
  motivation: string
  images: string       // JSON array of NPCImage
  status: ItemStatus
  sort_order: number
}

export interface SynopsisFaction {
  id: string           // campaign_factions.id
  scenario_id: string
  campaign_id: string
  name: string
  type: string
}

export interface SceneNPC {
  id: string
  name: string
  role: string
  description: string
  quote: string
  motivation: string
  images: string
}

export type SceneStatus = 'idea' | 'optional_step' | 'key_event'

export const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  idea: 'Idée',
  optional_step: 'Étape optionnelle',
  key_event: 'Événement clé',
}

export interface SceneArtefact {
  id: string
  name: string
  description: string
  images: string
}

export interface Scene {
  id: string
  scenario_id: string
  type: 'scene' | 'divider'
  status: SceneStatus
  sort_order: number
  title: string
  description: string
  outcome: string
  notes: string
  location_id: string
  location_name: string
  is_start: boolean
  is_end: boolean
  npcs: SceneNPC[]
  artefacts: SceneArtefact[]
  created_at: string
  updated_at: string
}

export interface SynopsisData {
  hook: HookData
}

export interface Synopsis {
  id: string
  scenario_id: string
  hook: string           // JSON string
  npcs: string           // JSON string (junction table, kept for snapshots)
  steps: string          // JSON string (legacy)
  overview_cache: string
  created_at: string
  updated_at: string
}

export interface Snapshot {
  id: string
  synopsis_id: string
  label: string
  data: string           // JSON string
  created_at: string
}

const defaultHook: HookData = { content: '', status: 'draft' }

function tryParse(json: string): unknown {
  try {
    const v = JSON.parse(json)
    if (typeof v === 'string') return JSON.parse(v)
    return v
  } catch { return undefined }
}

export function parseSynopsis(s: Synopsis): SynopsisData {
  const parsed = tryParse(s.hook)
  const hook = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Partial<HookData> : {}
  return {
    hook: { content: hook.content ?? defaultHook.content, status: hook.status ?? defaultHook.status },
  }
}

export function serializeSynopsis(data: SynopsisData) {
  return { hook: data.hook }
}
