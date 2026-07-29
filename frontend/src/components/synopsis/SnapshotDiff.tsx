import { cn } from '@/lib/utils'
import { stripMentions } from '@/lib/mentions'
import type { SynopsisData, Snapshot } from '@/types/synopsis'

interface Props {
  snapshot: Snapshot
  current: SynopsisData
}

function parseSnapshotData(data: string): SynopsisData | null {
  try {
    const v = JSON.parse(data)
    return { hook: v.hook ?? { content: '', status: 'draft' } }
  } catch { return null }
}

function DiffRow({ label, type }: { label: string; type: 'added' | 'removed' | 'changed' }) {
  const cls = {
    added:   'bg-green-50  border-green-200  text-green-800',
    removed: 'bg-red-50    border-red-200    text-red-800',
    changed: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  }[type]
  const icon = { added: '+', removed: '−', changed: '~' }[type]
  return (
    <div className={cn('flex gap-2 rounded border px-2 py-1 text-xs', cls)}>
      <span className="font-mono font-bold shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  )
}

export default function SnapshotDiff({ snapshot, current }: Props) {
  const snap = parseSnapshotData(snapshot.data)
  if (!snap) {
    return <p className="text-destructive text-sm">Données de snapshot corrompues.</p>
  }

  const hookChanged = snap.hook.content !== current.hook.content

  if (!hookChanged) {
    return <p className="text-muted-foreground text-sm">Aucune différence avec l'état actuel.</p>
  }

  return (
    <div className="space-y-5 text-sm">
      {hookChanged && (
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Synopsis</p>
          <div className="rounded border bg-red-50 border-red-200 p-2 text-xs text-red-800 line-through whitespace-pre-wrap">
            {stripMentions(snap.hook.content) || '(vide)'}
          </div>
          <div className="rounded border bg-green-50 border-green-200 p-2 text-xs text-green-800 whitespace-pre-wrap">
            {stripMentions(current.hook.content) || '(vide)'}
          </div>
        </section>
      )}
    </div>
  )
}
