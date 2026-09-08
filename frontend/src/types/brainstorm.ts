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

// A quote closes a JSON string only when the next non-space character is one of
// , } ] : — anything else means the model forgot to escape it inside its prose.
// Mirrors repairUnescapedQuotes in backend/internal/llm/decode.go, for envelopes
// stored before that repair existed.
function repairUnescapedQuotes(s: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escaped) {
      out += c
      escaped = false
      continue
    }
    if (c === '\\') {
      out += c
      if (inString) escaped = true
      continue
    }
    if (c === '"') {
      if (!inString) {
        inString = true
        out += c
      } else if (/^\s*([,}\]:]|$)/.test(s.slice(i + 1))) {
        inString = false
        out += c
      } else {
        out += '\\"'
      }
      continue
    }
    out += c
  }
  return out
}

// Parses a JSON envelope out of an LLM reply, tolerating a markdown code fence
// and quotes the model left unescaped inside its own prose.
function parseEnvelope(raw: string): ParsedAssistantMessage | null {
  const fenced = raw.trim().replace(/^```[a-z]*\n/, '').replace(/\n?```$/, '')
  for (const candidate of [fenced, repairUnescapedQuotes(fenced)]) {
    try {
      const p = JSON.parse(candidate)
      if (p && typeof p.message === 'string') {
        return { message: p.message, scene_suggestion: p.scene_suggestion ?? null }
      }
    } catch { /* try the next candidate */ }
  }
  return null
}

export function parseAssistantContent(content: string): ParsedAssistantMessage {
  const outer = parseEnvelope(content)
  if (outer) {
    // Guard against double-wrapping: message field itself is a JSON envelope
    const inner = parseEnvelope(outer.message)
    return inner ?? outer
  }
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
