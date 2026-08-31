import { useCampaignMentions } from '@/hooks/useCampaignMentions'
import { MENTION_KIND_LABEL, type MentionKind } from '@/lib/mentions'
import { parseRichText, type InlineRun } from '@/lib/richtext'

interface Props {
  campaignId: string
  text: string
  className?: string
  /** Called when a chip is clicked — open that entity. Omit for inert chips. */
  onOpen?: (kind: MentionKind, id: string) => void
}

/**
 * Read-only counterpart to MentionEditor: prose with its mentions drawn as
 * chips (names resolved live) and its `**bold**` / `*italic*` / `- list`
 * markers drawn as actual formatting — see lib/richtext.ts for the format.
 *
 * Anywhere authored text is displayed and not edited needs this, or the raw
 * markers show through. Where formatting cannot be drawn at all — a print
 * sheet, a truncated list preview — use stripMentions instead.
 */
export default function MentionText({ campaignId, text, className, onOpen }: Props) {
  const { resolve } = useCampaignMentions(campaignId)
  const blocks = parseRichText(text)

  function renderRun(run: InlineRun, key: number) {
    if (run.type === 'text') return <span key={key}>{run.text}</span>
    if (run.type === 'bold') return <strong key={key}>{run.text}</strong>
    if (run.type === 'italic') return <em key={key}>{run.text}</em>

    const live = resolve(run.kind, run.id)
    const label = `@${live ?? run.storedName}`
    const stale = live === undefined
    const cls = `mention-chip${stale ? ' mention-chip--stale' : ''}`
    // A stale chip has nothing to open, so it stays plain text.
    if (!onOpen || stale) {
      return <span key={key} className={cls} data-mention-kind={run.kind}>{label}</span>
    }
    return (
      <button
        key={key}
        type="button"
        className={`${cls} hover:underline`}
        data-mention-kind={run.kind}
        title={MENTION_KIND_LABEL[run.kind]}
        onClick={() => onOpen(run.kind, run.id)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        if (block.type === 'list') {
          return (
            <ul key={bi} className="list-disc pl-5">
              {block.items.map((runs, li) => (
                <li key={li}>{runs.map((r, ri) => renderRun(r, ri))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi}>
            {block.lines.map((runs, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {runs.map((r, ri) => renderRun(r, ri))}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
