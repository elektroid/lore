import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useCampaignMentions } from '@/hooks/useCampaignMentions'
import { type MentionKind } from '@/lib/mentions'

interface MentionAttrs {
  kind: MentionKind
  id: string
  label: string
}

/**
 * The live counterpart to the `@[name](ref)` text stored in the document —
 * a NodeView, so it's a real React component that re-renders on its own
 * whenever the campaign's entities change (rename, delete), no manual
 * DOM-walking relabel step needed like the old contentEditable version had.
 */
export default function MentionChip({ node, extension }: ReactNodeViewProps) {
  const { kind, id, label } = node.attrs as MentionAttrs
  const campaignId = extension.options.campaignId as string
  const { resolve } = useCampaignMentions(campaignId)
  const live = resolve(kind, id)
  const stale = live === undefined
  const cls = `mention-chip${stale ? ' mention-chip--stale' : ''}`

  return (
    <NodeViewWrapper as="span" className={cls} data-mention-kind={kind} contentEditable={false}>
      @{live ?? label}
    </NodeViewWrapper>
  )
}
