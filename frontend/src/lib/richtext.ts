// A deliberately small prose format — bold, italic, one level of bullet
// lists, plus the mentions from lib/mentions.ts. Not CommonMark: no headers,
// no tables, no nesting. Scene/entity descriptions are a paragraph or two of
// GM notes, not a document, and every extra construct here is one more thing
// every renderer (play console, print sheet, export) has to agree on.
//
// Storage stays plain text — `**bold**`, `*italic*`, `- item` lines — so
// nothing here changes what's in the database or in `Export JSON`; this is
// only about how that text is displayed.

import { parseMentionRef, type MentionKind } from './mentions'

export type InlineRun =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'mention'; kind: MentionKind; id: string; storedName: string }

export type Block =
  | { type: 'text'; lines: InlineRun[][] }
  | { type: 'list'; items: InlineRun[][] }

const INLINE_RE = /@\[([^\]]+)\]\(([^)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g
const LIST_ITEM_RE = /^\s*[-*]\s+(.*)$/

/** Split one line of text into runs: mentions, bold, italic, plain. */
export function parseInline(text: string): InlineRun[] {
  const out: InlineRun[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', text: text.slice(last, at) })
    if (m[1] !== undefined) {
      const { kind, id } = parseMentionRef(m[2])
      out.push({ type: 'mention', kind, id, storedName: m[1] })
    } else if (m[3] !== undefined) {
      out.push({ type: 'bold', text: m[3] })
    } else {
      out.push({ type: 'italic', text: m[4] })
    }
    last = at + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/**
 * Group lines into text runs and bullet lists. A run of consecutive
 * `- item` / `* item` lines becomes one list block; everything else stays a
 * flowing text block, same as before this existed.
 */
export function parseRichText(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM_RE)
    if (m) {
      const items: InlineRun[][] = []
      while (i < lines.length) {
        const mm = lines[i].match(LIST_ITEM_RE)
        if (!mm) break
        items.push(parseInline(mm[1]))
        i++
      }
      blocks.push({ type: 'list', items })
    } else {
      const textLines: InlineRun[][] = []
      while (i < lines.length && !lines[i].match(LIST_ITEM_RE)) {
        textLines.push(parseInline(lines[i]))
        i++
      }
      blocks.push({ type: 'text', lines: textLines })
    }
  }
  return blocks
}
