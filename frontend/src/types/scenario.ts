export type ScenarioStatus = 'draft' | 'active' | 'archived'

export interface Scenario {
  id: string
  campaign_id: string
  name: string
  status: ScenarioStatus
  created_at: string
  updated_at: string
}
