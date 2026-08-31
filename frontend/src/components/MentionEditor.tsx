import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, List, Code2 } from 'lucide-react'
import { useCampaignMentions, type CampaignMentions, type Mentionable } from '@/hooks/useCampaignMentions'
import { MENTION_KIND_BADGE, MENTION_KIND_LABEL } from '@/lib/mentions'
import { textToDoc, docToText } from '@/lib/richTextDoc'
import { Mention } from './mentionEditor/MentionExtension'

interface Props {
  campaignId: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

interface DropdownState {
  items: Mentionable[]
  activeIdx: number
  command: (item: Mentionable) => void
}

/**
 * A one-line-or-more prose field where typing `@` offers the campaign's PNJs,
 * artefacts, locations and factions, and `**bold**` / `*italic*` / `- lists`
 * render live instead of showing their markers (see lib/richtext.ts for the
 * format). What is stored is still that same plain string — not a relation
 * table for mentions, not an HTML blob for formatting — so a mention or a
 * bold word costs nothing to add and nothing to remove, and Export JSON never
 * has to know this editor exists.
 *
 * "Mode expert" swaps the rendered view for the raw string in a <textarea>,
 * for anyone who'd rather type `**bold**` directly than reach for a button.
 */
export default function MentionEditor({ campaignId, value, onChange, placeholder, disabled, className }: Props) {
  const [expert, setExpert] = useState(false)
  const [dd, setDd] = useState<DropdownState | null>(null)
  // TipTap's suggestion callbacks are built once (see the Mention.configure
  // call below) and invoked later from outside React's render cycle, so they
  // need refs — a captured `dd`/`mentions` value would go stale the moment
  // either changes.
  const ddRef = useRef<DropdownState | null>(null)
  useLayoutEffect(() => { ddRef.current = dd }, [dd])

  const mentions = useCampaignMentions(campaignId)
  const mentionsRef = useRef<CampaignMentions>(mentions)
  useLayoutEffect(() => { mentionsRef.current = mentions })

  const prevRef = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, codeBlock: false, horizontalRule: false,
        strike: false, code: false, orderedList: false, link: false, underline: false,
        // Otherwise TipTap silently appends an empty paragraph after a
        // trailing list block, purely so there's somewhere to click below
        // it — and docToText would serialize that as a stray trailing blank
        // line on every save. Double-Enter inside the last list item still
        // exits it and starts a normal paragraph, so nothing is lost.
        trailingNode: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      // The closures below only ever run from TipTap's own event handling,
      // never synchronously during this render — ddRef/mentionsRef exist
      // precisely so they read the latest value whenever that happens.
      // eslint-disable-next-line react-hooks/refs
      Mention.configure({
        campaignId,
        suggestion: {
          items: ({ query }) => mentionsRef.current.search(query),
          render: () => ({
            onStart: props => setDd({ items: props.items, activeIdx: 0, command: props.command }),
            onUpdate: props => setDd(d => ({ items: props.items, activeIdx: d ? Math.min(d.activeIdx, Math.max(props.items.length - 1, 0)) : 0, command: props.command })),
            onKeyDown: ({ event }) => {
              const current = ddRef.current
              if (!current) return false
              if (event.key === 'ArrowDown') {
                setDd(d => d && { ...d, activeIdx: Math.min(d.activeIdx + 1, d.items.length - 1) })
                return true
              }
              if (event.key === 'ArrowUp') {
                setDd(d => d && { ...d, activeIdx: Math.max(d.activeIdx - 1, 0) })
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const item = current.items[current.activeIdx]
                if (item) current.command(item)
                return true
              }
              if (event.key === 'Escape') { setDd(null); return true }
              return false
            },
            onExit: () => setDd(null),
          }),
        },
      }),
    ],
    content: textToDoc(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: [
          'mention-editor w-full min-h-[72px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          className ?? '',
        ].filter(Boolean).join(' '),
      },
    },
    onUpdate: ({ editor }) => {
      const text = docToText(editor.getJSON())
      prevRef.current = text
      onChange(text)
    },
  }, [campaignId])

  useEffect(() => { editor?.setEditable(!disabled) }, [disabled, editor])

  useEffect(() => {
    if (!editor || value === prevRef.current) return
    prevRef.current = value
    editor.commands.setContent(textToDoc(value), { emitUpdate: false })
  }, [value, editor])

  if (expert) {
    return (
      <div className="relative">
        <ExpertToggle expert={expert} onToggle={setExpert} />
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={[
            'mention-editor w-full min-h-[72px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm font-mono',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            disabled ? 'cursor-not-allowed opacity-50' : '',
            className ?? '',
          ].filter(Boolean).join(' ')}
        />
      </div>
    )
  }

  return (
    <div className="relative">
      {!disabled && (
        <div className="flex items-center gap-0.5 mb-1">
          <button
            type="button"
            title="Gras"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Italique"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Liste à puces"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1" />
          <ExpertToggle expert={expert} onToggle={setExpert} />
        </div>
      )}
      <EditorContent editor={editor} />
      {dd && dd.items.length > 0 && (
        <div className="absolute z-50 mt-1 min-w-[220px] rounded-md border bg-popover text-popover-foreground shadow-md py-1">
          {dd.items.map((item, i) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent hover:text-accent-foreground ${i === dd.activeIdx ? 'bg-accent text-accent-foreground' : ''}`}
              onMouseDown={e => { e.preventDefault(); dd.command(item) }}
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

function ExpertToggle({ expert, onToggle }: { expert: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      type="button"
      title={expert ? 'Revenir à l\'édition normale' : 'Mode expert — éditer le markdown brut'}
      className={`h-6 w-6 flex items-center justify-center rounded hover:bg-accent ${expert ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      onMouseDown={e => e.preventDefault()}
      onClick={() => onToggle(!expert)}
    >
      <Code2 className="h-3.5 w-3.5" />
    </button>
  )
}
