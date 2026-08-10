export interface Game {
  id: string
  name: string
  slug: string
  genre: string
  description: string
  visual_style: string
  mistral_agent_id: string
  sheet_template_id: string | null
  sheet_template_name: string
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

export interface GameLoreEntitiesPage {
  entities: GameLoreEntity[]
  total: number
  page: number
  page_size: number
}

export interface RelatedEntityLink {
  relation_id: string
  relation: string
  entity_id: string
  name: string
  kind: string
}

export interface GameLoreEntityRelationsResponse {
  outgoing: RelatedEntityLink[]
  incoming: RelatedEntityLink[]
}
