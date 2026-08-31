import { useRef, useEffect, useState, useCallback } from 'react'
import { Bold, Italic, List } from 'lucide-react'
import { useCampaignMentions, type Mentionable } from '@/hooks/useCampaignMentions'
import {
  MENTION_RE, MENTION_KIND_BADGE, MENTION_KIND_LABEL,
  mentionRef, parseMentionRef, type MentionKind,
} from '@/lib/mentions'

interface DropdownState {
  query: string
  node: Text
  atOffset: number
}

interface Props {
  campaignId: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

// Accented letters count as part of a name: "@Ré" must keep searching, not drop
// the dropdown at the "é". \w would.
const TRIGGER_RE = /@([\p{L}\p{N}_'-]*)$/u

type Resolve = (kind: MentionKind, id: string) => string | undefined

function buildHTML(text: string, resolve: Resolve): string {
  let result = ''
  let last = 0
  for (const m of text.matchAll(MENTION_RE)) {
    result += esc(text.slice(last, m.index))
    const [, storedName, ref] = m
    const { kind, id } = parseMentionRef(ref)
    const live = resolve(kind, id)
    result += chipHTML(ref, storedName, kind, live ?? storedName, live === undefined)
    last = (m.index ?? 0) + m[0].length
  }
  result += esc(text.slice(last))
  return result
}

function chipHTML(ref: string, storedName: string, kind: MentionKind, label: string, stale: boolean): string {
  return `<span contenteditable="false" data-mention="${escAttr(ref)}" data-name="${escAttr(storedName)}"` +
    ` data-mention-kind="${kind}" class="mention-chip${stale ? ' mention-chip--stale' : ''}">@${esc(label)}</span>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

function serialize(el: HTMLElement): string {
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node as Text).textContent ?? ''
    } else if (node instanceof HTMLElement) {
      if (node.dataset.mention) {
        out += `@[${node.dataset.name ?? ''}](${node.dataset.mention})`
      } else if (node.tagName === 'BR') {
        out += '\n'
      } else if (node.tagName === 'DIV') {
        out += '\n' + serialize(node)
      }
    }
  }
  return out
}

function getMentionTrigger(el: HTMLElement): DropdownState | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return null
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null
  const before = ((node as Text).textContent ?? '').slice(0, range.startOffset)
  const match = before.match(TRIGGER_RE)
  if (!match) return null
  return { query: match[1], node: node as Text, atOffset: range.startOffset - match[0].length }
}

/**
 * A one-line-or-more prose field where typing `@` offers the campaign's PNJs,
 * artefacts, locations and factions. What is stored is text with inline refs
 * (see lib/mentions.ts) — not a relation table, so a mention costs nothing to
 * add and nothing to remove, and prose stays prose.
 */
export default function MentionEditor({ campaignId, value, onChange, placeholder, disabled, className }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const prevRef = useRef(value)
  const [dd, setDd] = useState<DropdownState | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const mentions = useCampaignMentions(campaignId)
  const { resolve, search, all } = mentions

  const applyHTML = useCallback((text: string) => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = text === '' ? '' : buildHTML(text, resolve)
  }, [resolve])

  useEffect(() => { applyHTML(value) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (value !== prevRef.current) {
      prevRef.current = value
      applyHTML(value)
    }
  }, [value, applyHTML])

  // Relabel chips once the entity lists land, and whenever an entity is renamed
  // or deleted elsewhere. Rewriting labels in place rather than re-rendering the
  // whole field keeps the caret where the GM left it.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('[data-mention]').forEach(span => {
      const { kind, id } = parseMentionRef(span.dataset.mention!)
      const live = resolve(kind, id)
      span.dataset.mentionKind = kind
      span.textContent = `@${live ?? span.dataset.name ?? ''}`
      span.classList.toggle('mention-chip--stale', live === undefined)
    })
  }, [resolve, all.length])

  function handleInput() {
    const el = editorRef.current
    if (!el) return
    const text = serialize(el)
    if (text === '' || text === '\n') el.innerHTML = ''
    prevRef.current = text
    onChange(text)
    const trigger = getMentionTrigger(el)
    if (trigger) { setDd(trigger); setActiveIdx(0) }
    else setDd(null)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!dd) return
    const found = search(dd.query)
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, found.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if ((e.key === 'Enter' || e.key === 'Tab') && found.length > 0) { e.preventDefault(); insertMention(found[activeIdx]) }
    else if (e.key === 'Escape') setDd(null)
  }

  function insertMention(item: Mentionable) {
    if (!dd) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const cursorOffset = sel.getRangeAt(0).startOffset

    const deleteRange = document.createRange()
    deleteRange.setStart(dd.node, dd.atOffset)
    deleteRange.setEnd(dd.node, cursorOffset)
    deleteRange.deleteContents()

    const chipEl = document.createElement('span')
    chipEl.contentEditable = 'false'
    chipEl.dataset.mention = mentionRef(item.kind, item.id)
    chipEl.dataset.name = item.name
    chipEl.dataset.mentionKind = item.kind
    chipEl.className = 'mention-chip'
    chipEl.textContent = `@${item.name}`

    const space = document.createTextNode(' ')
    deleteRange.insertNode(space)
    deleteRange.insertNode(chipEl)

    const r = document.createRange()
    r.setStart(space, 1)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)

    const text = serialize(editorRef.current!)
    prevRef.current = text
    onChange(text)
    setDd(null)
  }

  const found = dd ? search(dd.query) : []

  /**
   * Wrap the selection in `**bold**` / `*italic*` markers, or insert an empty
   * pair with the caret in the middle when nothing is selected. Goes through
   * execCommand('insertText') so it's indistinguishable from typing — the
   * existing onInput -> handleInput path picks it up, same as everything else
   * in this editor.
   */
  function applyMarker(marker: string) {
    const el = editorRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return
    const selected = sel.toString()
    document.execCommand('insertText', false, marker + selected + marker)
    if (selected === '') {
      const sel2 = window.getSelection()
      const node = sel2?.getRangeAt(0)?.startContainer
      if (sel2 && node && node.nodeType === Node.TEXT_NODE) {
        const r = document.createRange()
        r.setStart(node, Math.max(0, sel2.getRangeAt(0).startOffset - marker.length))
        r.collapse(true)
        sel2.removeAllRanges()
        sel2.addRange(r)
      }
    }
  }

  /**
   * Prefix the current line with `- `. Line-level rather than
   * selection-level, because the browser represents lines two different
   * ways here: the first line is a flat run of siblings directly under the
   * editor, every line after it is wrapped in its own <div> by the browser's
   * native Enter handling. Doesn't check for or toggle off an existing `- ` —
   * clicking twice stacks markers, a rough edge left for later rather than
   * solved now.
   */
  function applyListPrefix() {
    const el = editorRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return

    let top: Node = range.startContainer
    if (top !== el) {
      while (top.parentNode && top.parentNode !== el) top = top.parentNode
    }

    const r = document.createRange()
    if (top === el) {
      // Cursor sits directly in the editor (empty field, or an ambiguous
      // spot) — no specific line to anchor to, fall back to the very start.
      r.setStart(el, 0)
    } else if (top instanceof HTMLDivElement) {
      // A later line: insert inside its own <div>, not before it — the div
      // itself is the line, "before" it would land in the previous one.
      r.setStart(top, 0)
    } else {
      // The first line: walk back past sibling nodes (text runs, mention
      // chips) to the true start of the line, not just the node the cursor
      // happens to be in.
      let first = top
      while (first.previousSibling
        && !(first.previousSibling instanceof HTMLDivElement)
        && !(first.previousSibling instanceof HTMLBRElement)) {
        first = first.previousSibling
      }
      r.setStartBefore(first)
    }
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    document.execCommand('insertText', false, '- ')
  }

  return (
    <div className="relative">
      {!disabled && (
        <div className="flex items-center gap-0.5 mb-1">
          <button
            type="button"
            title="Gras (** **)"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={() => applyMarker('**')}
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Italique (* *)"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={() => applyMarker('*')}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Liste à puces (- )"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={applyListPrefix}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setDd(null), 150)}
        data-placeholder={placeholder}
        className={[
          'mention-editor w-full min-h-[72px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          disabled ? 'cursor-not-allowed opacity-50' : '',
          className ?? '',
        ].filter(Boolean).join(' ')}
      />
      {dd && found.length > 0 && (
        <div className="absolute z-50 mt-1 min-w-[220px] rounded-md border bg-popover text-popover-foreground shadow-md py-1">
          {found.map((item, i) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent hover:text-accent-foreground ${i === activeIdx ? 'bg-accent text-accent-foreground' : ''}`}
              onMouseDown={e => { e.preventDefault(); insertMention(item) }}
            >
              <span className="font-medium flex-1 truncate">{item.name}</span>
              {item.sub && <span className="text-xs text-muted-foreground truncate">{item.sub}</span>}
              <span className={`text-xs px-1 py-0.5 rounded shrink-0 ${MENTION_KIND_BADGE[item.kind]}`}>
                {MENTION_KIND_LABEL[item.kind]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
