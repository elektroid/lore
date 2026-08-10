export type FieldScope = 'pc' | 'npc'

export type FieldType = 'number' | 'select' | 'text' | 'formula' | 'skill_list'

export interface SelectOption {
  value: string
  label: string
}

export interface SkillItem {
  key: string
  label: string
  stat?: string
  group?: string
}

export interface SheetField {
  key: string
  label: string
  type: FieldType
  scope: FieldScope[]
  // number
  min?: number
  max?: number
  default?: number
  // select
  options?: SelectOption[]
  // formula
  expression?: string
  // skill_list
  items?: SkillItem[]
}

export interface SheetSection {
  title: string
  fields: SheetField[]
}

export interface SheetSchema {
  sections: SheetSection[]
}

export interface SheetTemplate {
  id: string
  name: string
  schema: string // JSON-encoded SheetSchema
  created_at: string
  updated_at: string
}

export const EMPTY_SCHEMA: SheetSchema = { sections: [] }

export function parseSheetSchema(raw: string | undefined | null): SheetSchema {
  if (!raw) return EMPTY_SCHEMA
  try {
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.sections)) return parsed as SheetSchema
    return EMPTY_SCHEMA
  } catch {
    return EMPTY_SCHEMA
  }
}

// Sheet values as stored on player_characters.sheet / campaign_npcs.sheet:
// a flat {fieldKey: value} map. skill_list fields nest a {skillKey: level} map
// under their own key.
export type SheetValues = Record<string, unknown>

export function parseSheetValues(raw: string | undefined | null): SheetValues {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as SheetValues : {}
  } catch {
    return {}
  }
}
