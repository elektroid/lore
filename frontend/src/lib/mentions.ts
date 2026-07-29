// Mentions — referring to one campaign entity from inside another's prose.
//
// A mention is stored inline in the text it was typed into:
//
//   @[name](ref)
//
// `name` is the entity's name at the moment of typing. It is a fallback label,
// not the source of truth: every renderer re-resolves `ref` against the live
// entity list, so renaming a PNJ updates every sentence that mentions it. The
// stored name is what shows when the entity is gone — a stale chip the GM can
// see and fix, rather than a silently empty gap.
//
// `ref` is `kind:uuid`, except for PNJs, which are stored as a bare uuid. That
// asymmetry is not a design choice — mentions shipped as a PNJ-only feature and
// existing scene descriptions carry bare uuids. Reading them keeps working.

export type MentionKind = 'npc' | 'artefact' | 'location' | 'faction'

/** Global — callers relying on `lastIndex` must use their own copy. */
export const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g

// PNJs are absent on purpose: their ref carries no prefix. See above.
const PREFIXES: Record<Exclude<MentionKind, 'npc'>, string> = {
  artefact: 'artefact:',
  location: 'location:',
  faction: 'faction:',
}

/** The order kinds appear in the suggestion dropdown. */
export const MENTION_KINDS: MentionKind[] = ['npc', 'artefact', 'location', 'faction']

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  npc: 'PNJ',
  artefact: 'Artefact',
  location: 'Lieu',
  faction: 'Faction',
}

/** Badge colours, one hue per kind, legible in both themes. */
export const MENTION_KIND_BADGE: Record<MentionKind, string> = {
  npc: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  artefact: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  location: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  faction: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

/** The `ref` to store for an entity of this kind. */
export function mentionRef(kind: MentionKind, id: string): string {
  return kind === 'npc' ? id : PREFIXES[kind] + id
}

/**
 * Split a stored ref back into kind and entity id. An unprefixed ref is a PNJ,
 * which also makes any future unknown prefix resolve as a stale PNJ chip rather
 * than throwing — a mention typed by a newer version of the app degrades to a
 * visible label instead of breaking the editor it appears in.
 */
export function parseMentionRef(ref: string): { kind: MentionKind; id: string } {
  for (const kind of MENTION_KINDS) {
    if (kind === 'npc') continue
    const prefix = PREFIXES[kind]
    if (ref.startsWith(prefix)) return { kind, id: ref.slice(prefix.length) }
  }
  return { kind: 'npc', id: ref }
}

export interface ParsedMention {
  kind: MentionKind
  id: string
  /** The name captured when the mention was typed. */
  storedName: string
}

export type MentionSegment =
  | { type: 'text'; text: string }
  | ({ type: 'mention' } & ParsedMention)

/** Split text into plain runs and mentions, in order, losing nothing. */
export function parseMentionSegments(text: string): MentionSegment[] {
  const out: MentionSegment[] = []
  let last = 0
  for (const m of text.matchAll(MENTION_RE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', text: text.slice(last, at) })
    out.push({ type: 'mention', storedName: m[1], ...parseMentionRef(m[2]) })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/**
 * Flatten mentions to `@name` for places that can only show plain text — a
 * truncated list preview, a print sheet, a diff. Uses the stored name, since
 * these callers have no entity list to resolve against.
 */
export function stripMentions(text: string): string {
  return text.replace(MENTION_RE, '@$1')
}
