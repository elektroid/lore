// A run: one group of players and their playthrough of a campaign. The campaign
// is written once and played by several groups, so a group's party and its
// progress hang off here rather than off the story.
// See docs/adr/0001-runs-separate-story-from-play.md.

export type RunStatus = 'active' | 'finished' | 'archived'

export interface Run {
  id: string
  campaign_id: string
  name: string
  notes: string
  status: RunStatus
  player_count: number
  created_at: string
  updated_at: string
}

export interface RunPlayer {
  id: string
  run_id: string
  user_id: string
  user_name: string
  user_email: string
  character_id: string
  character_name: string
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  active: 'En cours',
  finished: 'Terminé',
  archived: 'Archivé',
}
