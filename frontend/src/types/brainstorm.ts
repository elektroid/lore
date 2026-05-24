export interface BrainstormThread {
  id: string
  scenario_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface SceneSuggestion {
  title: string
  description: string
  outcome: string
}

export interface BrainstormMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string  // plain text for user; JSON envelope for assistant
  created_at: string
}

export interface ParsedAssistantMessage {
  message: string
  scene_suggestion: SceneSuggestion | null
}

export function parseAssistantContent(content: string): ParsedAssistantMessage {
  try {
    const p = JSON.parse(content)
    if (p && typeof p.message === 'string') {
      // Guard against double-wrapping: message field itself is a JSON envelope
      try {
        const inner = JSON.parse(p.message)
        if (inner && typeof inner.message === 'string') return inner
      } catch { /* not nested */ }
      return p
    }
  } catch { /* fall through */ }
  // Last resort: try to extract a JSON envelope from anywhere in the string
  const match = content.match(/\{[\s\S]*"message"\s*:\s*"[\s\S]*"\s*[,}]/)
  if (match) {
    try {
      const p = JSON.parse(match[0].endsWith('}') ? match[0] : match[0] + '}')
      if (p && typeof p.message === 'string') return p
    } catch { /* ignore */ }
  }
  return { message: content, scene_suggestion: null }
}
