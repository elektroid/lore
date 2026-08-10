// Player mode: an authenticated player's own view of the runs they are seated
// in. Account-scoped only — no campaign story content lives here.
// See docs/adr/0001-runs-separate-story-from-play.md.

import type { RunStatus } from '@/types/run'

export interface PlayerRun {
  run_id: string
  run_name: string
  status: RunStatus
  campaign_id: string
  campaign_name: string
  character_id: string
  character_name: string
  last_session_date: string
}

export interface ListPlayerRunsResponse {
  runs: PlayerRun[]
}

export interface PlayerSession {
  id: string
  name: string
  date: string
  table_token: string
}

export interface PlayerRunDetail {
  run_id: string
  run_name: string
  status: RunStatus
  campaign_id: string
  campaign_name: string
  game_id: string
  character_id: string
  character_name: string
  sessions: PlayerSession[]
}

export interface RunNote {
  run_id: string
  body: string
  updated_at: string
}
