export type ScenarioStatus = 'draft' | 'active' | 'archived'

export interface Scenario {
  id: string
  campaign_id: string
  name: string
  status: ScenarioStatus
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}
