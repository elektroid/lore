import { useCampaignMentions } from '@/hooks/useCampaignMentions'
import { parseMentionSegments, MENTION_KIND_LABEL, type MentionKind } from '@/lib/mentions'

interface Props {
  campaignId: string
  text: string
  className?: string
  /** Called when a chip is clicked — open that entity. Omit for inert chips. */
  onOpen?: (kind: MentionKind, id: string) => void
}

/**
 * Read-only counterpart to MentionEditor: prose with its mentions drawn as
 * chips, names resolved live.
 *
 * Anywhere authored text is displayed and not edited needs this, or the raw
 * `@[name](ref)` shows through. Where a chip cannot be drawn at all — a print
 * sheet, a truncated list preview — use stripMentions instead.
 */
export default function MentionText({ campaignId, text, className, onOpen }: Props) {
  const { resolve } = useCampaignMentions(campaignId)
  const segments = parseMentionSegments(text)

  return (
    <p className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.text}</span>
        const live = resolve(seg.kind, seg.id)
        const label = `@${live ?? seg.storedName}`
        const stale = live === undefined
        const cls = `mention-chip${stale ? ' mention-chip--stale' : ''}`
        // A stale chip has nothing to open, so it stays plain text.
        if (!onOpen || stale) {
          return <span key={i} className={cls} data-mention-kind={seg.kind}>{label}</span>
        }
        return (
          <button
            key={i}
            type="button"
            className={`${cls} hover:underline`}
            data-mention-kind={seg.kind}
            title={MENTION_KIND_LABEL[seg.kind]}
            onClick={() => onOpen(seg.kind, seg.id)}
          >
            {label}
          </button>
        )
      })}
    </p>
  )
}
