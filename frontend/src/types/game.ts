export interface Game {
  id: string
  name: string
  slug: string
  genre: string
  visual_style: string
  mistral_agent_id: string
  created_at: string
}

export interface GameDocument {
  name: string
  url: string
}

export interface GameLoreEntity {
  id: string
  game_id: string
  kind: string
  name: string
  tags: string
  summary: string
  excerpt: string
  source_title: string
  source_page: number
  created_at: string
}

export interface GameLoreEntityRelation {
  id: string
  game_id: string
  from_entity_id: string
  to_entity_id: string
  relation: string
  source_title: string
  source_page: number
  created_at: string
}
