import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import type { Mentionable } from '@/hooks/useCampaignMentions'
import { type MentionKind } from '@/lib/mentions'
import MentionChip from './MentionChip'

export interface MentionOptions {
  /** Needed by MentionChip to resolve live names — see its extension.options read. */
  campaignId: string
  suggestion: Partial<SuggestionOptions<Mentionable>>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mention: {
      insertMention: (attrs: { kind: MentionKind; id: string; label: string }) => ReturnType
    }
  }
}

/**
 * The editable counterpart to lib/mentions.ts's `@[name](ref)` text —
 * an atom node so it moves and deletes as one unit, same as the old
 * contentEditable's chip <span>. `items`/`render` (the search results and the
 * dropdown UI) are supplied per editor by MentionEditor, since both need
 * campaign data and React state this generic node has no business owning.
 */
export const Mention = Node.create<MentionOptions>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      campaignId: '',
      suggestion: {
        char: '@',
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, [
            { type: 'mention', attrs: { kind: props.kind, id: props.id, label: props.name } },
            { type: 'text', text: ' ' },
          ]).run()
        },
      },
    }
  },

  addAttributes() {
    return {
      kind: { default: null, parseHTML: el => el.getAttribute('data-mention-kind') },
      id: { default: null, parseHTML: el => el.getAttribute('data-mention-id') },
      label: { default: '', parseHTML: el => el.getAttribute('data-mention-label') },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-mention': '',
      'data-mention-kind': node.attrs.kind,
      'data-mention-id': node.attrs.id,
      'data-mention-label': node.attrs.label,
    }), `@${node.attrs.label}`]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChip)
  },

  addCommands() {
    return {
      insertMention: attrs => ({ chain }) => chain().insertContent({ type: this.name, attrs }).run(),
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
