// Converts between the plain-text format in lib/richtext.ts (bold/italic/
// lists/mentions, all stored as one string) and the TipTap document MentionEditor
// edits. The parse direction reuses parseRichText so there is exactly one
// place that understands the text format; this file only knows how to map
// that parsed shape onto ProseMirror's JSON node shape and back.

import type { JSONContent } from '@tiptap/react'
import { parseRichText, type Block, type InlineRun } from './richtext'
import { mentionRef } from './mentions'

function runsToNodes(runs: InlineRun[]): JSONContent[] {
  return runs.map(run => {
    if (run.type === 'mention') {
      return { type: 'mention', attrs: { kind: run.kind, id: run.id, label: run.storedName } }
    }
    if (run.type === 'bold') return { type: 'text', text: run.text, marks: [{ type: 'bold' }] }
    if (run.type === 'italic') return { type: 'text', text: run.text, marks: [{ type: 'italic' }] }
    return { type: 'text', text: run.text }
  })
}

function blockToNode(block: Block): JSONContent {
  if (block.type === 'list') {
    return {
      type: 'bulletList',
      content: block.items.map(runs => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: runsToNodes(runs) }],
      })),
    }
  }
  const content: JSONContent[] = []
  block.lines.forEach((runs, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    content.push(...runsToNodes(runs))
  })
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/** The stored plain-text value -> a TipTap document, for loading the editor. */
export function textToDoc(text: string): JSONContent {
  return { type: 'doc', content: parseRichText(text).map(blockToNode) }
}

function listItemInline(listItem: JSONContent): JSONContent[] {
  const p = (listItem.content ?? []).find(n => n.type === 'paragraph')
  return p?.content ?? []
}

function inlineToText(content: JSONContent[]): string {
  let out = ''
  for (const node of content) {
    if (node.type === 'hardBreak') { out += '\n'; continue }
    if (node.type === 'mention' && node.attrs) {
      out += `@[${node.attrs.label ?? ''}](${mentionRef(node.attrs.kind, node.attrs.id)})`
      continue
    }
    if (node.type === 'text') {
      const bold = node.marks?.some(m => m.type === 'bold')
      const italic = node.marks?.some(m => m.type === 'italic')
      const text = node.text ?? ''
      // Combined bold+italic has no representation in this format (see
      // richtext.ts) — bold wins rather than producing garbled markers.
      out += bold ? `**${text}**` : italic ? `*${text}*` : text
    }
  }
  return out
}

function blockToText(node: JSONContent): string {
  if (node.type === 'bulletList') {
    return (node.content ?? [])
      .map(item => '- ' + inlineToText(listItemInline(item)))
      .join('\n')
  }
  return inlineToText(node.content ?? [])
}

/** A TipTap document -> the plain-text value that gets saved. */
export function docToText(doc: JSONContent): string {
  return (doc.content ?? []).map(blockToText).join('\n\n')
}
