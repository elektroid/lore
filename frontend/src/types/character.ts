export interface PlayerCharacter {
  id: string
  user_id: string
  game_id: string
  game_name: string
  name: string
  description: string
  personal_story: string
  sheet: string
  created_at: string
  updated_at: string
}

export interface CreateCharacterRequest {
  game_id: string
  name: string
  description: string
  personal_story: string
  sheet: string
}

export interface UpdateCharacterRequest {
  name: string
  description: string
  personal_story: string
  sheet: string
}

export interface ListCharactersResponse {
  characters: PlayerCharacter[]
}

export interface GetCharacterResponse {
  character: PlayerCharacter
}
