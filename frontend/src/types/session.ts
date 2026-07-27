export interface Player {
  player_name: string
  character_name: string
}

export interface Session {
  id: string
  scenario_id: string
  name: string
  date: string
  players: string           // JSON Player[] — legacy, replaced by session_players
  active_location_id: string
  active_scene_id: string
  table_token: string       // share token for the table screen and player seats
  projection: string        // JSON Projection — see types/table.ts
  created_at: string
  updated_at: string
}

export interface SessionPlayer {
  id: string
  session_id: string
  user_id: string
  user_name: string
  user_email: string
  character_id: string
  character_name: string
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

export function parsePlayers(json: string): Player[] {
  try { return JSON.parse(json) || [] } catch { return [] }
}
