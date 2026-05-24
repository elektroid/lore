import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { CampaignNPC, CampaignFaction } from '@/types/entities'

// Token format:
//   NPC:     @[name](uuid)
//   Faction: @[name](faction:uuid)
const TOKEN_RE = /@\[([^\]]+)\]\(([^)]+)\)/g

type MentionItem =
  | { kind: 'npc'; id: string; name: string; sub: string }
  | { kind: 'faction'; id: string; name: string; sub: string }

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
}

function factionStorageId(id: string) { return `faction:${id}` }
function isFactionId(id: string) { return id.startsWith('faction:') }
function stripFactionPrefix(id: string) { return id.slice('faction:'.length) }

function buildHTML(text: string, npcMap: Map<string, string>, factionMap: Map<string, string>): string {
  let result = ''
  let last = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    result += esc(text.slice(last, m.index))
    const [, storedName, id] = m
    let displayName: string
    let stale: boolean
    let extra = ''
    if (isFactionId(id)) {
      const rawId = stripFactionPrefix(id)
      displayName = factionMap.get(rawId) ?? storedName
      stale = !factionMap.has(rawId)
      extra = ' data-mention-kind="faction"'
    } else {
      displayName = npcMap.get(id) ?? storedName
      stale = !npcMap.has(id)
    }
    result += `<span contenteditable="false" data-mention="${escAttr(id)}" data-name="${escAttr(storedName)}"${extra} class="mention-chip${stale ? ' mention-chip--stale' : ''}">@${esc(displayName)}</span>`
    last = (m.index ?? 0) + m[0].length
  }
  result += esc(text.slice(last))
  return result
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
  const match = before.match(/@(\w*)$/)
  if (!match) return null
  return { query: match[1], node: node as Text, atOffset: range.startOffset - match[0].length }
}

export default function MentionEditor({ campaignId, value, onChange, placeholder, disabled }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const prevRef = useRef(value)
  const [dd, setDd] = useState<DropdownState | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const { data: npcs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
    enabled: !!campaignId,
    staleTime: 60_000,
  })

  const { data: factions = [] } = useQuery({
    queryKey: ['campaign-factions', campaignId],
    queryFn: () => api.get<CampaignFaction[]>(`/campaigns/${campaignId}/factions`),
    enabled: !!campaignId,
    staleTime: 60_000,
  })

  const npcMap = useMemo(() => new Map(npcs.map(n => [n.id, n.name])), [npcs])
  const factionMap = useMemo(() => new Map(factions.map(f => [f.id, f.name])), [factions])

  const applyHTML = useCallback((text: string) => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = buildHTML(text, npcMap, factionMap)
    if (text === '') el.innerHTML = ''
  }, [npcMap, factionMap])

  useEffect(() => { applyHTML(value) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (value !== prevRef.current) {
      prevRef.current = value
      applyHTML(value)
    }
  }, [value, applyHTML])

  // Resolve chip labels when data arrives
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('[data-mention]').forEach(span => {
      const id = span.dataset.mention!
      if (isFactionId(id)) {
        const rawId = stripFactionPrefix(id)
        const resolved = factionMap.get(rawId)
        const stale = resolved === undefined
        span.textContent = `@${resolved ?? span.dataset.name ?? ''}`
        span.classList.toggle('mention-chip--stale', stale)
      } else {
        const resolved = npcMap.get(id)
        const stale = resolved === undefined
        span.textContent = `@${resolved ?? span.dataset.name ?? ''}`
        span.classList.toggle('mention-chip--stale', stale)
      }
    })
  }, [npcMap, factionMap, npcs.length, factions.length])

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
    const matches = getMatches(dd.query)
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if ((e.key === 'Enter' || e.key === 'Tab') && matches.length > 0) { e.preventDefault(); insertMention(matches[activeIdx]) }
    else if (e.key === 'Escape') setDd(null)
  }

  function getMatches(query: string): MentionItem[] {
    const q = query.toLowerCase()
    const npcMatches: MentionItem[] = npcs
      .filter(n => n.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map(n => ({ kind: 'npc', id: n.id, name: n.name, sub: n.role }))
    const facMatches: MentionItem[] = factions
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, 3)
      .map(f => ({ kind: 'faction', id: f.id, name: f.name, sub: f.type }))
    return [...npcMatches, ...facMatches].slice(0, 8)
  }

  function insertMention(item: MentionItem) {
    if (!dd) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const cursorOffset = sel.getRangeAt(0).startOffset

    const deleteRange = document.createRange()
    deleteRange.setStart(dd.node, dd.atOffset)
    deleteRange.setEnd(dd.node, cursorOffset)
    deleteRange.deleteContents()

    const storageId = item.kind === 'faction' ? factionStorageId(item.id) : item.id

    const chipEl = document.createElement('span')
    chipEl.contentEditable = 'false'
    chipEl.dataset.mention = storageId
    chipEl.dataset.name = item.name
    if (item.kind === 'faction') chipEl.dataset.mentionKind = 'faction'
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

  const matches = dd ? getMatches(dd.query) : []

  return (
    <div className="relative">
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
        ].filter(Boolean).join(' ')}
      />
      {dd && matches.length > 0 && (
        <div className="absolute z-50 mt-1 min-w-[220px] rounded-md border bg-popover text-popover-foreground shadow-md py-1">
          {matches.map((item, i) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent hover:text-accent-foreground ${i === activeIdx ? 'bg-accent text-accent-foreground' : ''}`}
              onMouseDown={e => { e.preventDefault(); insertMention(item) }}
            >
              <span className="font-medium flex-1 truncate">{item.name}</span>
              {item.sub && <span className="text-xs text-muted-foreground truncate">{item.sub}</span>}
              <span className={`text-xs px-1 py-0.5 rounded shrink-0 ${item.kind === 'faction' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                {item.kind === 'faction' ? 'Faction' : 'PNJ'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
