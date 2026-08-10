export interface LLMConfig {
  base_url: string
  api_key: string
  model: string
  max_tokens: number
}

export interface Campaign {
  id: string
  name: string
  genre: string
  game_id: string
  game_name: string
  llm_config: string
  owner_id: string
  owner_name: string
  created_at: string
  updated_at: string
  access?: 'owner' | 'member'
}

export interface ArchivedCampaign {
  id: string
  name: string
  game_name: string
  owner_id: string
  owner_name: string
  archived_by: string
  archived_at: string
}

export function parseLLMConfig(json: string): LLMConfig {
  try {
    const p = JSON.parse(json)
    return {
      base_url: p.base_url ?? '',
      api_key: p.api_key ?? '',
      model: p.model ?? '',
      max_tokens: typeof p.max_tokens === 'number' ? p.max_tokens : 2000,
    }
  } catch {
    return { base_url: '', api_key: '', model: '', max_tokens: 2000 }
  }
}

export function serializeLLMConfig(cfg: LLMConfig): string {
  const out: Partial<LLMConfig> = {}
  if (cfg.base_url) out.base_url = cfg.base_url
  if (cfg.api_key) out.api_key = cfg.api_key
  if (cfg.model) out.model = cfg.model
  if (cfg.max_tokens) out.max_tokens = cfg.max_tokens
  return JSON.stringify(out)
}
