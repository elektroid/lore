// One evening: the group that played it (run_id) and the story it advanced
// (scenario_id). See docs/adr/0001-runs-separate-story-from-play.md.
export interface Session {
  id: string
  scenario_id: string
  run_id: string
  name: string
  date: string
  active_location_id: string
  active_scene_id: string
  table_token: string       // share token for the table screen and player seats
  projection: string        // JSON Projection — see types/table.ts
  created_at: string
  updated_at: string
}

export interface MemberCharacter {
  id: string
  name: string
  description: string
  game_id: string
  game_name: string
}

export interface MemberWithCharacters {
  user_id: string
  user_name: string
  user_email: string
  characters: MemberCharacter[]
}

export type ScenePlayState = 'pending' | 'cleared' | 'void'
