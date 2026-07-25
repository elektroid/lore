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
