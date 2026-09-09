import { parseRichText, type InlineRun } from '@/lib/richtext'
import { MENTION_KIND_LABEL } from '@/lib/mentions'
import { mentionRefOf, type MentionNames } from './helpers'

function Run({ run, names }: { run: InlineRun; names?: MentionNames }) {
  if (run.type === 'bold') return <strong>{run.text}</strong>
  if (run.type === 'italic') return <em>{run.text}</em>
  if (run.type === 'text') return <>{run.text}</>

  // A deleted entity keeps the name it had when it was typed — the same
  // fallback the editor uses, and very nearly right.
  const name = names?.get(mentionRefOf(run.kind, run.id)) ?? run.storedName
  return (
    <span className="doc-mention" title={MENTION_KIND_LABEL[run.kind]}>{name}</span>
  )
}

/**
 * Authored prose, printed: `**bold**`, `*italic*`, `- lists` and mentions, in
 * the format described by lib/richtext.ts. Paragraph structure is preserved,
 * which is why the round trip in richTextDoc.ts has to be exact.
 */
export default function PrintProse({
  text, names, className,
}: {
  text: string
  names?: MentionNames
  className?: string
}) {
  if (!text.trim()) return null
  const blocks = parseRichText(text)

  return (
    <div className={`doc-prose ${className ?? ''}`}>
      {blocks.map((block, bi) => block.type === 'list' ? (
        <ul key={bi}>
          {block.items.map((runs, li) => (
            <li key={li}>{runs.map((r, ri) => <Run key={ri} run={r} names={names} />)}</li>
          ))}
        </ul>
      ) : (
        <p key={bi}>
          {block.lines.map((runs, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {runs.map((r, ri) => <Run key={ri} run={r} names={names} />)}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
