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

/**
 * How this block is separated from the one before it in the stored text.
 *
 * `'\n\n'` is a paragraph break, `'\n'` a plain line break — the difference
 * between two paragraphs and a bullet list sitting directly under its intro
 * line. Carrying it on the block is what lets serialization put back exactly
 * the separator that was parsed, instead of guessing one per block type and
 * growing or shrinking the text a little on every save.
 */
export type BlockSep = '\n' | '\n\n'

export type Block =
  | { type: 'text'; lines: InlineRun[][]; sep: BlockSep }
  | { type: 'list'; items: InlineRun[][]; sep: BlockSep }

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
 * Group the stored text into paragraphs and bullet lists.
 *
 * A blank line is a paragraph break — so the text splits on `\n\n` first, and
 * each paragraph is then scanned for runs of `- item` / `* item` lines, which
 * become list blocks. A single `\n` inside a paragraph stays a line break.
 *
 * Splitting on the blank line is what makes the round trip exact. Before it,
 * every paragraph the author typed (or pasted) collapsed into the previous one
 * on the next load: the parser merged all consecutive non-list lines into one
 * block, so three pasted paragraphs came back as one with line breaks in it.
 */
export function parseRichText(text: string): Block[] {
  const blocks: Block[] = []

  text.split('\n\n').forEach((paragraph, pi) => {
    const lines = paragraph.split('\n')
    let i = 0
    let first = true
    while (i < lines.length) {
      // The first block of a paragraph is preceded by the blank line that
      // started it; anything after it in the same paragraph is one line down.
      const sep: BlockSep = first && pi > 0 ? '\n\n' : '\n'
      first = false

      if (lines[i].match(LIST_ITEM_RE)) {
        const items: InlineRun[][] = []
        while (i < lines.length) {
          const mm = lines[i].match(LIST_ITEM_RE)
          if (!mm) break
          items.push(parseInline(mm[1]))
          i++
        }
        blocks.push({ type: 'list', items, sep })
      } else {
        const textLines: InlineRun[][] = []
        while (i < lines.length && !lines[i].match(LIST_ITEM_RE)) {
          textLines.push(parseInline(lines[i]))
          i++
        }
        blocks.push({ type: 'text', lines: textLines, sep })
      }
    }
  })

  return blocks
}

const LIST_MARKER_RE = /^\s*[-*]\s+/

/**
 * The text as a reader would say it out loud: mentions become `@Name`, the
 * `**`/`*` markers drop away, `- item` lines lose their bullet.
 *
 * For the places that cannot draw formatting at all — a `line-clamp` preview,
 * a one-line summary. `stripMentions` alone is not enough there: it only
 * handles the `@[…](…)` tokens and leaves the asterisks on screen.
 */
export function toPlainText(text: string): string {
  return text
    .split('\n')
    .map(line => parseInline(line.replace(LIST_MARKER_RE, '')).map(run => (
      run.type === 'mention' ? `@${run.storedName}` : run.text
    )).join(''))
    .join('\n')
}
